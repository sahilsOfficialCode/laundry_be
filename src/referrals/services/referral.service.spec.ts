import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ReferralService } from './referral.service';
import { ReferralSettingsService } from './referral-settings.service';
import { FraudDetectionService } from './fraud-detection.service';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralRepository } from '../repositories/referral.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import { User } from '../../users/schemas/user.schema';
import { ReferralStatus, RewardStatus } from '../enums/referral.enums';

describe('ReferralService', () => {
  let service: ReferralService;
  let repo: jest.Mocked<ReferralRepository>;
  let userModel: { findOne: jest.Mock; findById: jest.Mock; exists: jest.Mock; updateOne: jest.Mock };
  let fraud: { evaluate: jest.Mock };
  let notifications: { sendToUser: jest.Mock };

  const settings = {
    referralEnabled: true,
    codeLength: 7,
    referralExpiryDays: 30,
    dailyLimit: 0,
    monthlyLimit: 0,
    lifetimeLimit: 0,
    pushNotificationsEnabled: true,
  } as any;

  /** Chainable mock for `findOne(...).select(...).lean()`. */
  const leanFindOne = (result: unknown) => ({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(result),
    }),
  });

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      exists: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    fraud = { evaluate: jest.fn().mockResolvedValue({ blocked: false, reasons: [] }) };
    notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: ReferralRepository,
          useValue: {
            findReferralByReferee: jest.fn(),
            createReferral: jest.fn(),
            countSuccessfulSince: jest.fn().mockResolvedValue(0),
            countReferrals: jest.fn().mockResolvedValue(0),
            aggregateRewards: jest.fn().mockResolvedValue([]),
            writeLog: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ReferralSettingsService,
          useValue: { get: jest.fn().mockResolvedValue(settings) },
        },
        { provide: FraudDetectionService, useValue: fraud },
        { provide: ReferralRewardService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ReferralService);
    repo = module.get(ReferralRepository);
  });

  describe('validateCode', () => {
    it('rejects when the programme is disabled', async () => {
      const settingsService = { get: jest.fn().mockResolvedValue({ ...settings, referralEnabled: false }) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: getModelToken(User.name), useValue: userModel },
          { provide: ReferralRepository, useValue: repo },
          { provide: ReferralSettingsService, useValue: settingsService },
          { provide: FraudDetectionService, useValue: fraud },
          { provide: ReferralRewardService, useValue: {} },
          { provide: NotificationsService, useValue: notifications },
        ],
      }).compile();
      const disabled = module.get(ReferralService);

      await expect(disabled.validateCode('ABCDEFG')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects malformed codes before hitting the database', async () => {
      await expect(service.validateCode('!!')).rejects.toThrow(
        BadRequestException,
      );
      expect(userModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects unknown codes', async () => {
      userModel.findOne.mockReturnValue(leanFindOne(null));
      await expect(service.validateCode('NOSUCH1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects self-referral', async () => {
      userModel.findOne.mockReturnValue(
        leanFindOne({ _id: 'me', name: 'Me' }),
      );
      await expect(service.validateCode('MYCODE1', 'me')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects users who were already referred', async () => {
      userModel.findOne.mockReturnValue(
        leanFindOne({ _id: 'referrer', name: 'Amit' }),
      );
      repo.findReferralByReferee.mockResolvedValue({ _id: 'r1' } as any);

      await expect(service.validateCode('AMITCODE', 'me')).rejects.toThrow(
        ConflictException,
      );
    });

    it('normalizes the code and returns the referrer name on success', async () => {
      userModel.findOne.mockReturnValue(
        leanFindOne({ _id: 'referrer', name: 'Amit' }),
      );
      repo.findReferralByReferee.mockResolvedValue(null);

      const res = await service.validateCode('  amitcode ', 'me');

      expect(res).toEqual({
        valid: true,
        code: 'AMITCODE',
        referrerName: 'Amit',
      });
    });
  });

  describe('applyReferral', () => {
    const dto = { code: 'AMITCODE' } as any;

    it('rejects a user who already used a code', async () => {
      repo.findReferralByReferee.mockResolvedValue({ _id: 'r1' } as any);
      await expect(service.applyReferral('me', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.createReferral).not.toHaveBeenCalled();
    });

    it('rejects self-referral', async () => {
      repo.findReferralByReferee.mockResolvedValue(null);
      userModel.findOne.mockReturnValue(leanFindOne({ _id: 'me' }));
      await expect(service.applyReferral('me', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stores a REJECTED referral and throws when fraud blocks it', async () => {
      repo.findReferralByReferee.mockResolvedValue(null);
      userModel.findOne.mockReturnValue(leanFindOne({ _id: 'referrer' }));
      fraud.evaluate.mockResolvedValue({
        blocked: true,
        reasons: ['SAME_DEVICE'],
      });
      repo.createReferral.mockResolvedValue({
        _id: 'r1',
        status: ReferralStatus.REJECTED,
      } as any);

      await expect(service.applyReferral('me', dto)).rejects.toThrow(
        ForbiddenException,
      );

      expect(repo.createReferral).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReferralStatus.REJECTED,
          fraudSuspected: true,
          fraudReasons: ['SAME_DEVICE'],
        }),
      );
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it('creates the referral and notifies the referrer on success', async () => {
      repo.findReferralByReferee.mockResolvedValue(null);
      userModel.findOne.mockReturnValue(leanFindOne({ _id: 'referrer' }));
      repo.createReferral.mockResolvedValue({
        _id: 'r1',
        status: ReferralStatus.REGISTERED,
      } as any);

      const res = await service.applyReferral('me', dto);

      expect(res).toEqual({
        success: true,
        referralId: 'r1',
        status: ReferralStatus.REGISTERED,
      });
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        'referrer',
        expect.objectContaining({ type: 'referral_registered' }),
      );
    });

    it('maps the unique-index race (E11000) to the same conflict as pre-check', async () => {
      repo.findReferralByReferee.mockResolvedValue(null); // pre-check passes
      userModel.findOne.mockReturnValue(leanFindOne({ _id: 'referrer' }));
      const dup = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      repo.createReferral.mockRejectedValue(dup);

      await expect(service.applyReferral('me', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('enforces the daily referral limit', async () => {
      const limited = { ...settings, dailyLimit: 1 };
      const settingsService = { get: jest.fn().mockResolvedValue(limited) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: getModelToken(User.name), useValue: userModel },
          {
            provide: ReferralRepository,
            useValue: {
              findReferralByReferee: jest.fn().mockResolvedValue(null),
              createReferral: jest.fn(),
              countSuccessfulSince: jest.fn().mockResolvedValue(1), // at limit
              writeLog: jest.fn(),
            },
          },
          { provide: ReferralSettingsService, useValue: settingsService },
          { provide: FraudDetectionService, useValue: fraud },
          { provide: ReferralRewardService, useValue: {} },
          { provide: NotificationsService, useValue: notifications },
        ],
      }).compile();
      const svc = module.get(ReferralService);
      userModel.findOne.mockReturnValue(leanFindOne({ _id: 'referrer' }));

      await expect(svc.applyReferral('me', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('hasReferrer', () => {
    it('returns true when a referral row exists for the user', async () => {
      repo.findReferralByReferee.mockResolvedValue({ _id: 'r1' } as any);
      await expect(service.hasReferrer('me')).resolves.toBe(true);
    });

    it('returns false for never-referred users', async () => {
      repo.findReferralByReferee.mockResolvedValue(null);
      await expect(service.hasReferrer('me')).resolves.toBe(false);
    });
  });

  describe('refereeRewardApplies', () => {
    it('is false when the user was never referred', async () => {
      repo.findReferralByReferee.mockResolvedValue(null);
      await expect(service.refereeRewardApplies('me')).resolves.toBe(false);
    });

    it('is true while the referral can still pay out', async () => {
      repo.findReferralByReferee.mockResolvedValue({
        status: ReferralStatus.REGISTERED,
      } as any);
      await expect(service.refereeRewardApplies('me')).resolves.toBe(true);
    });

    it('is false for rejected / expired referrals (they get the ordinary discount)', async () => {
      repo.findReferralByReferee.mockResolvedValue({
        status: ReferralStatus.REJECTED,
      } as any);
      await expect(service.refereeRewardApplies('me')).resolves.toBe(false);

      repo.findReferralByReferee.mockResolvedValue({
        status: ReferralStatus.EXPIRED,
      } as any);
      await expect(service.refereeRewardApplies('me')).resolves.toBe(false);
    });
  });

  describe('handleQualifyingOrder', () => {
    const rewardSettings = { ...settings, minimumOrderValue: 50 };
    const paidOrder = {
      _id: 'o1',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      billAmount: 349,
      firstOrderDiscountAmount: 0,
    };

    function makeReferralDoc(over: Record<string, any> = {}) {
      const doc: any = {
        _id: 'r1',
        referrerId: 'REF',
        refereeId: 'FRIEND',
        status: ReferralStatus.REGISTERED,
        qualifyingOrderId: undefined,
        firstOrderAt: null,
        ...over,
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      return doc;
    }

    async function build(mocks: {
      referralDoc: any;
      rewardsByReferral: jest.Mock;
      releaseRewards?: jest.Mock;
      createPendingRewards?: jest.Mock;
    }) {
      const repoMock = {
        findReferralByReferee: jest.fn().mockResolvedValue(mocks.referralDoc),
        findRewardsByReferral: mocks.rewardsByReferral,
        findReferralsWithPendingRewards: jest.fn().mockResolvedValue([]),
        writeLog: jest.fn().mockResolvedValue(undefined),
      };
      const rewardService = {
        createPendingRewards:
          mocks.createPendingRewards ?? jest.fn().mockResolvedValue(undefined),
        releaseRewards: mocks.releaseRewards ?? jest.fn().mockResolvedValue(0),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: getModelToken(User.name), useValue: userModel },
          { provide: ReferralRepository, useValue: repoMock },
          {
            provide: ReferralSettingsService,
            useValue: { get: jest.fn().mockResolvedValue(rewardSettings) },
          },
          { provide: FraudDetectionService, useValue: fraud },
          { provide: ReferralRewardService, useValue: rewardService },
          { provide: NotificationsService, useValue: notifications },
        ],
      }).compile();
      return {
        svc: module.get<ReferralService>(ReferralService),
        rewardService,
      };
    }

    it('first pass: records the milestone, passes the discount as refereeAlreadyCredited, releases and finalizes', async () => {
      const referralDoc = makeReferralDoc();
      const rewardsByReferral = jest
        .fn()
        .mockResolvedValueOnce([
          { beneficiaryType: 'REFERRER', status: RewardStatus.PENDING, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.PENDING, amount: 50 },
        ])
        .mockResolvedValue([
          { beneficiaryType: 'REFERRER', status: RewardStatus.RELEASED, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.RELEASED, amount: 50 },
        ]);
      const releaseRewards = jest.fn().mockResolvedValue(150);
      const { svc, rewardService } = await build({
        referralDoc,
        rewardsByReferral,
        releaseRewards,
      });

      await svc.handleQualifyingOrder('FRIEND', {
        ...paidOrder,
        firstOrderDiscountAmount: 0,
      });

      expect(rewardService.createPendingRewards).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { refereeAlreadyCredited: 0 },
      );
      expect(releaseRewards).toHaveBeenCalledWith('r1', 'SYSTEM');
      expect(referralDoc.status).toBe(ReferralStatus.REWARD_RELEASED);
    });

    it('retry pass: a half-released referral gets its still-PENDING referee reward released without re-notifying the referrer', async () => {
      const referralDoc = makeReferralDoc({
        status: ReferralStatus.PAYMENT_COMPLETED,
        qualifyingOrderId: 'o1',
      });
      const rewardsByReferral = jest
        .fn()
        .mockResolvedValueOnce([
          { beneficiaryType: 'REFERRER', status: RewardStatus.RELEASED, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.PENDING, amount: 50 },
        ])
        .mockResolvedValue([
          { beneficiaryType: 'REFERRER', status: RewardStatus.RELEASED, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.RELEASED, amount: 50 },
        ]);
      const releaseRewards = jest.fn().mockResolvedValue(50);
      const { svc, rewardService } = await build({
        referralDoc,
        rewardsByReferral,
        releaseRewards,
      });

      await svc.handleQualifyingOrder('FRIEND', paidOrder);

      expect(rewardService.createPendingRewards).not.toHaveBeenCalled();
      expect(releaseRewards).toHaveBeenCalledWith('r1', 'SYSTEM');
      expect(referralDoc.status).toBe(ReferralStatus.REWARD_RELEASED);
      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        'FRIEND',
        expect.objectContaining({ type: 'referral_reward_released' }),
      );
    });

    it('retry pass with nothing pending is a no-op (no release attempted)', async () => {
      const referralDoc = makeReferralDoc({
        status: ReferralStatus.REWARD_RELEASED,
        qualifyingOrderId: 'o1',
      });
      const rewardsByReferral = jest.fn().mockResolvedValue([
        { beneficiaryType: 'REFERRER', status: RewardStatus.RELEASED, amount: 100 },
        { beneficiaryType: 'REFEREE', status: RewardStatus.RELEASED, amount: 50 },
      ]);
      const releaseRewards = jest.fn().mockResolvedValue(0);
      const { svc } = await build({
        referralDoc,
        rewardsByReferral,
        releaseRewards,
      });

      await svc.handleQualifyingOrder('FRIEND', paidOrder);

      expect(releaseRewards).not.toHaveBeenCalled();
    });

    it('leaves the referral in PAYMENT_COMPLETED when a reward is still PENDING after release', async () => {
      const referralDoc = makeReferralDoc();
      const rewardsByReferral = jest
        .fn()
        .mockResolvedValueOnce([
          { beneficiaryType: 'REFERRER', status: RewardStatus.PENDING, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.PENDING, amount: 50 },
        ])
        .mockResolvedValue([
          { beneficiaryType: 'REFERRER', status: RewardStatus.RELEASED, amount: 100 },
          { beneficiaryType: 'REFEREE', status: RewardStatus.PENDING, amount: 50 },
        ]);
      const { svc } = await build({
        referralDoc,
        rewardsByReferral,
        releaseRewards: jest.fn().mockResolvedValue(100),
      });

      await svc.handleQualifyingOrder('FRIEND', paidOrder);

      expect(referralDoc.status).toBe(ReferralStatus.PAYMENT_COMPLETED);
    });
  });

  describe('reconcileStrandedRewards', () => {
    it('retries release for every referral that still has a pending reward', async () => {
      const stranded: any = {
        _id: 'r1',
        referrerId: 'REF',
        refereeId: 'FRIEND',
        status: ReferralStatus.PAYMENT_COMPLETED,
      };
      stranded.save = jest.fn().mockResolvedValue(stranded);

      const repoMock = {
        findReferralsWithPendingRewards: jest.fn().mockResolvedValue([stranded]),
        findRewardsByReferral: jest
          .fn()
          .mockResolvedValueOnce([
            { beneficiaryType: 'REFEREE', status: RewardStatus.PENDING, amount: 50 },
          ])
          .mockResolvedValue([
            { beneficiaryType: 'REFEREE', status: RewardStatus.RELEASED, amount: 50 },
          ]),
        writeLog: jest.fn().mockResolvedValue(undefined),
      };
      const releaseRewards = jest.fn().mockResolvedValue(50);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: getModelToken(User.name), useValue: userModel },
          { provide: ReferralRepository, useValue: repoMock },
          {
            provide: ReferralSettingsService,
            useValue: { get: jest.fn().mockResolvedValue(settings) },
          },
          { provide: FraudDetectionService, useValue: fraud },
          {
            provide: ReferralRewardService,
            useValue: { releaseRewards, createPendingRewards: jest.fn() },
          },
          { provide: NotificationsService, useValue: notifications },
        ],
      }).compile();
      const svc = module.get<ReferralService>(ReferralService);

      const settled = await svc.reconcileStrandedRewards();

      expect(releaseRewards).toHaveBeenCalledWith('r1', 'SYSTEM');
      expect(settled).toBe(1);
      expect(stranded.status).toBe(ReferralStatus.REWARD_RELEASED);
    });

    it('returns 0 without work when nothing is stranded', async () => {
      const repoMock = {
        findReferralsWithPendingRewards: jest.fn().mockResolvedValue([]),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: getModelToken(User.name), useValue: userModel },
          { provide: ReferralRepository, useValue: repoMock },
          { provide: ReferralSettingsService, useValue: { get: jest.fn() } },
          { provide: FraudDetectionService, useValue: fraud },
          { provide: ReferralRewardService, useValue: {} },
          { provide: NotificationsService, useValue: notifications },
        ],
      }).compile();
      const svc = module.get<ReferralService>(ReferralService);

      await expect(svc.reconcileStrandedRewards()).resolves.toBe(0);
    });
  });
});
