// The AuthService import chain pulls in firebase-admin → jwks-rsa → jose (ESM),
// which the repo's current jest transform can't load. AuthService is only a DI
// token here (fully mocked below), so stub the native SDK entrypoints.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({ verifyIdToken: jest.fn() })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRepository } from '../repositories/account-deletion.repository';
import { IdentityVerificationService } from './identity-verification.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TokenBlacklistService } from '../../auth/token-blacklist.service';
import { AuthService } from '../../auth/auth.service';
import { User } from '../../users/schemas/user.schema';
import { WalletTransaction } from '../../wallet/schemas/wallet-transaction.schema';
import {
  AccountStatus,
  DeleteReason,
  DeleteRequestStatus,
  DeletionFlow,
} from '../enums/account-deletion.enums';

/**
 * Focused coverage for the two deletion flows:
 *  - IMMEDIATE (Android/Web) — request then confirm deletes right away.
 *  - ADMIN_APPROVAL (iOS) — request parks PENDING_APPROVAL, notifies admin,
 *    does NOT touch the account; only executeApprovedDeletion() deletes.
 */
describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let userModel: any;
  let repo: {
    findActiveByUser: jest.Mock;
    findById: jest.Mock;
    findLatestByUser: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    writeAudit: jest.Mock;
  };
  let notifications: {
    notifyAdmin: jest.Mock;
    sendToUser: jest.Mock;
    removeAllTokens: jest.Mock;
  };
  let authService: { clearAccountStatusCache: jest.Mock };
  let tokenBlacklist: { revoke: jest.Mock };

  const mkUser = (over: Record<string, any> = {}) => ({
    _id: 'u1',
    name: 'Jane',
    email: 'jane@example.com',
    mobileNumber: '+919999999999',
    isDeleted: false,
    walletBalance: 0,
    accountStatus: AccountStatus.ACTIVE,
    ...over,
  });

  beforeEach(async () => {
    userModel = {
      _doc: mkUser(),
      findById: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(userModel._doc),
        }),
      })),
      updateOne: jest
        .fn()
        .mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    };
    repo = {
      findActiveByUser: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      findLatestByUser: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ _id: 'req1', ...d })),
      update: jest.fn().mockResolvedValue({}),
      writeAudit: jest.fn().mockResolvedValue({}),
    };
    notifications = {
      notifyAdmin: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn().mockResolvedValue(undefined),
      removeAllTokens: jest.fn().mockResolvedValue(undefined),
    };
    authService = { clearAccountStatusCache: jest.fn() };
    tokenBlacklist = { revoke: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: getModelToken(WalletTransaction.name),
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
        { provide: AccountDeletionRepository, useValue: repo },
        {
          provide: IdentityVerificationService,
          useValue: { verify: jest.fn() },
        },
        { provide: NotificationsService, useValue: notifications },
        { provide: TokenBlacklistService, useValue: tokenBlacklist },
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

  // ── requestDelete — immediate flow (unchanged) ─────────────────────────────

  it('immediate flow: creates a VERIFIED request and does NOT touch the account or notify admin', async () => {
    const res = await service.requestDelete(
      'u1',
      { reason: DeleteReason.OTHER },
      {},
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: DeleteRequestStatus.VERIFIED }),
    );
    expect(userModel.updateOne).not.toHaveBeenCalled();
    expect(notifications.notifyAdmin).not.toHaveBeenCalled();
    expect(res.pendingApproval).toBe(false);
  });

  // ── requestDelete — admin-approval flow (iOS) ──────────────────────────────

  it('approval flow: parks PENDING_APPROVAL, marks accountStatus PENDING_DELETION, notifies admin, deletes nothing', async () => {
    const res = await service.requestDelete(
      'u1',
      { reason: DeleteReason.PRIVACY_CONCERNS, flow: DeletionFlow.ADMIN_APPROVAL },
      {},
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: DeleteRequestStatus.PENDING_APPROVAL }),
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'u1' },
      { $set: { accountStatus: AccountStatus.PENDING_DELETION } },
    );
    expect(notifications.notifyAdmin).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(res.pendingApproval).toBe(true);
  });

  it('approval flow: a second request is de-duplicated (no new request, no second admin notification)', async () => {
    repo.findActiveByUser.mockResolvedValue({
      _id: 'req1',
      status: DeleteRequestStatus.PENDING_APPROVAL,
      reason: DeleteReason.OTHER,
      createdAt: new Date(),
    });

    const res = await service.requestDelete(
      'u1',
      { reason: DeleteReason.OTHER, flow: DeletionFlow.ADMIN_APPROVAL },
      {},
    );

    expect(repo.create).not.toHaveBeenCalled();
    expect(notifications.notifyAdmin).not.toHaveBeenCalled();
    expect(res.pendingApproval).toBe(true);
  });

  // ── confirmDelete guard ───────────────────────────────────────────────────

  it('confirmDelete refuses a request that is awaiting admin approval', async () => {
    repo.findActiveByUser.mockResolvedValue({
      _id: 'req1',
      status: DeleteRequestStatus.PENDING_APPROVAL,
    });

    await expect(service.confirmDelete('u1', {}, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  // ── executeApprovedDeletion (admin path) ──────────────────────────────────

  it('executeApprovedDeletion refuses a request that is not PENDING_APPROVAL', async () => {
    repo.findById.mockResolvedValue({
      _id: 'req1',
      status: DeleteRequestStatus.VERIFIED,
    });
    await expect(
      service.executeApprovedDeletion('req1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executeApprovedDeletion soft-deletes, notifies the user BEFORE clearing tokens, completes the request and clears the auth cache', async () => {
    repo.findById.mockResolvedValue({
      _id: 'req1',
      userId: 'u1',
      status: DeleteRequestStatus.PENDING_APPROVAL,
      reason: DeleteReason.OTHER,
      comment: null,
    });

    const order: string[] = [];
    notifications.sendToUser.mockImplementation(async () => {
      order.push('notify');
    });
    notifications.removeAllTokens.mockImplementation(async () => {
      order.push('removeTokens');
    });

    const res = await service.executeApprovedDeletion('req1', 'admin1');

    expect(res.status).toBe(AccountStatus.DELETED);
    // account soft-deleted + all sessions invalidated, guarded so a replay
    // modifies nothing (isDeleted != true), and the unique identifiers +
    // credentials are released immediately (not deferred to the cleanup cron).
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'u1', isDeleted: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({
          isDeleted: true,
          isActive: false,
          accountStatus: AccountStatus.DELETED,
          sessionsValidFrom: expect.any(Date),
          walletBalance: 0,
        }),
        $unset: expect.objectContaining({
          email: '',
          mobileNumber: '',
          password: '',
        }),
      }),
    );
    // user is told deletion is complete, and that push goes out while tokens
    // still exist (before removeAllTokens)
    expect(order).toEqual(['notify', 'removeTokens']);
    // request finalised + audit cache invalidated
    expect(repo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({
        status: DeleteRequestStatus.COMPLETED,
        adminId: 'admin1',
      }),
    );
    expect(authService.clearAccountStatusCache).toHaveBeenCalledWith('u1');
    // no user token on the admin path
    expect(tokenBlacklist.revoke).not.toHaveBeenCalled();
  });

  it('executeDeletion is idempotent: a replay (0 rows modified) forfeits no wallet again and sends no second notification, but still drives the request to COMPLETED', async () => {
    userModel._doc = mkUser({ walletBalance: 500 });
    userModel.updateOne.mockResolvedValueOnce({
      acknowledged: true,
      modifiedCount: 0, // already deleted by a prior (partially-failed) run
    });
    repo.findById.mockResolvedValue({
      _id: 'req1',
      userId: 'u1',
      status: DeleteRequestStatus.PENDING_APPROVAL,
      reason: DeleteReason.OTHER,
      comment: null,
      userEmail: 'jane@example.com',
      userMobile: '+919999999999',
    });
    const walletModel = (service as any).walletTxnModel;

    await service.executeApprovedDeletion('req1', 'admin1');

    expect(walletModel.create).not.toHaveBeenCalled(); // no double forfeit
    expect(notifications.sendToUser).not.toHaveBeenCalled(); // no second notice
    expect(repo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: DeleteRequestStatus.COMPLETED }),
    );
  });

  // ── getStatus ────────────────────────────────────────────────────────────

  it('getStatus reports accountStatus even when there is no request', async () => {
    userModel._doc = mkUser({ accountStatus: AccountStatus.ACTIVE });
    const res = await service.getStatus('u1');
    expect(res).toEqual({ hasRequest: false, accountStatus: AccountStatus.ACTIVE });
  });
});
