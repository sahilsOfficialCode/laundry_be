import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralRepository } from '../repositories/referral.repository';
import { User } from '../../users/schemas/user.schema';
import { WalletTransaction } from '../../wallet/schemas/wallet-transaction.schema';
import { RewardStatus, RewardType } from '../enums/referral.enums';

describe('ReferralRewardService', () => {
  let service: ReferralRewardService;
  let repo: jest.Mocked<ReferralRepository>;
  let userModel: { findOneAndUpdate: jest.Mock; findById: jest.Mock; updateOne: jest.Mock };
  let txnModel: { create: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };

  const settings = {
    rewardType: RewardType.WALLET_CREDIT,
    referrerRewardAmount: 100,
    refereeRewardAmount: 50,
    rewardPercentage: 0,
    maximumReferralReward: 500,
  } as any;

  const makeReward = (over: Partial<Record<string, any>> = {}) => ({
    _id: over._id ?? 'reward1',
    referralId: 'ref1',
    beneficiaryId: over.beneficiaryId ?? 'userA',
    rewardType: over.rewardType ?? RewardType.WALLET_CREDIT,
    amount: over.amount ?? 100,
    status: over.status ?? RewardStatus.PENDING,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  beforeEach(async () => {
    session = {
      withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    userModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ walletBalance: 150 }),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue({ walletBalance: 150 }),
        }),
      }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    txnModel = {
      // With a session mongoose create([docs], opts) resolves to an array.
      create: jest.fn().mockResolvedValue([{ _id: 'txn1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralRewardService,
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn().mockResolvedValue(session) },
        },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(WalletTransaction.name), useValue: txnModel },
        {
          provide: ReferralRepository,
          useValue: {
            findRewardsByReferral: jest.fn(),
            claimReward: jest.fn(),
            createReward: jest.fn(),
            writeLog: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(ReferralRewardService);
    repo = module.get(ReferralRepository);
  });

  describe('computeAmount', () => {
    it('returns the base amount for fixed rewards', () => {
      expect(service.computeAmount(settings, 100)).toBe(100);
    });

    it('computes percentage of first order value', () => {
      const pct = {
        ...settings,
        rewardType: RewardType.PERCENTAGE,
        rewardPercentage: 10,
      };
      expect(service.computeAmount(pct, 0, 400)).toBe(40);
    });

    it('caps the payout at maximumReferralReward', () => {
      const pct = {
        ...settings,
        rewardType: RewardType.PERCENTAGE,
        rewardPercentage: 50,
        maximumReferralReward: 120,
      };
      expect(service.computeAmount(pct, 0, 1000)).toBe(120);
    });
  });

  describe('releaseRewards', () => {
    it('credits pending wallet rewards atomically and returns the total', async () => {
      const reward = makeReward();
      const claimed = makeReward({ status: RewardStatus.RELEASED });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward.mockResolvedValue(claimed as any);

      const total = await service.releaseRewards('ref1', 'SYSTEM');

      expect(total).toBe(100);
      expect(repo.claimReward).toHaveBeenCalledWith(
        'reward1',
        RewardStatus.PENDING,
        expect.objectContaining({ status: RewardStatus.RELEASED }),
      );
      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'userA' },
        { $inc: { walletBalance: 100 } },
        expect.objectContaining({ new: true }),
      );
      // Ledger fields recorded on the wallet transaction.
      const txnDoc = txnModel.create.mock.calls[0][0][0];
      expect(txnDoc).toMatchObject({
        userId: 'userA',
        amount: 100,
        category: 'REFERRAL_REWARD',
        openingBalance: 50,
        closingBalance: 150,
        createdBy: 'SYSTEM',
        referenceId: 'referral:ref1',
      });
      expect(claimed.save).toHaveBeenCalled();
    });

    it('skips rewards another caller already claimed (no double credit)', async () => {
      const reward = makeReward();
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward.mockResolvedValue(null); // lost the race

      const total = await service.releaseRewards('ref1');

      expect(total).toBe(0);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(txnModel.create).not.toHaveBeenCalled();
    });

    it('skips rewards that are not PENDING', async () => {
      repo.findRewardsByReferral.mockResolvedValue([
        makeReward({ status: RewardStatus.RELEASED }),
        makeReward({ status: RewardStatus.REVERSED }),
      ] as any);

      const total = await service.releaseRewards('ref1');

      expect(total).toBe(0);
      expect(repo.claimReward).not.toHaveBeenCalled();
    });

    it('hands the claim back and rethrows when the wallet credit fails', async () => {
      const reward = makeReward();
      const claimed = makeReward({ status: RewardStatus.RELEASED });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward
        .mockResolvedValueOnce(claimed as any) // the claim
        .mockResolvedValueOnce(reward as any); // the rollback
      userModel.findOneAndUpdate.mockRejectedValue(new Error('network down'));

      await expect(service.releaseRewards('ref1')).rejects.toThrow(
        'network down',
      );

      // Rollback: RELEASED → PENDING so a retry can release it.
      expect(repo.claimReward).toHaveBeenLastCalledWith(
        'reward1',
        RewardStatus.RELEASED,
        expect.objectContaining({ status: RewardStatus.PENDING }),
      );
      expect(txnModel.create).not.toHaveBeenCalled();
    });

    it('marks non-wallet rewards released without touching the wallet', async () => {
      const reward = makeReward({ rewardType: RewardType.COUPON });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward.mockResolvedValue(reward as any);

      const total = await service.releaseRewards('ref1');

      expect(total).toBe(0);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('reverseRewards', () => {
    it('debits released rewards and marks them reversed', async () => {
      const reward = makeReward({ status: RewardStatus.RELEASED });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward.mockResolvedValue(
        makeReward({ status: RewardStatus.REVERSED }) as any,
      );

      const total = await service.reverseRewards('ref1', 'fraud', 'ADMIN:1');

      expect(total).toBe(100);
      expect(repo.claimReward).toHaveBeenCalledWith(
        'reward1',
        RewardStatus.RELEASED,
        expect.objectContaining({ status: RewardStatus.REVERSED, note: 'fraud' }),
      );
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'userA' },
        { $inc: { walletBalance: -100 } },
        expect.anything(),
      );
    });

    it('does not double-debit when another caller already reversed', async () => {
      const reward = makeReward({ status: RewardStatus.RELEASED });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward.mockResolvedValue(null);

      const total = await service.reverseRewards('ref1', 'dup', 'ADMIN:1');

      expect(total).toBe(0);
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('restores the claim and rethrows when the debit fails', async () => {
      const reward = makeReward({ status: RewardStatus.RELEASED });
      repo.findRewardsByReferral.mockResolvedValue([reward] as any);
      repo.claimReward
        .mockResolvedValueOnce(reward as any)
        .mockResolvedValueOnce(reward as any);
      userModel.updateOne.mockRejectedValue(new Error('write failed'));

      await expect(
        service.reverseRewards('ref1', 'fraud', 'ADMIN:1'),
      ).rejects.toThrow('write failed');

      expect(repo.claimReward).toHaveBeenLastCalledWith(
        'reward1',
        RewardStatus.REVERSED,
        expect.objectContaining({ status: RewardStatus.RELEASED }),
      );
    });
  });
});
