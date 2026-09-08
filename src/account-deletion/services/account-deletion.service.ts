import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnCategory,
  WalletTxnStatus,
  WalletTxnType,
} from '../../wallet/schemas/wallet-transaction.schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { TokenBlacklistService } from '../../auth/token-blacklist.service';
import { AuthService } from '../../auth/auth.service';
import { AccountDeletionRepository } from '../repositories/account-deletion.repository';
import { IdentityVerificationService } from './identity-verification.service';
import {
  ConfirmDeleteDto,
  RequestDeleteDto,
  VerifyDeleteDto,
} from '../dto/account-deletion.dto';
import {
  AccountStatus,
  AuditAction,
  DeleteRequestStatus,
  DeletionFlow,
} from '../enums/account-deletion.enums';

/** Request context passed from the controller (ip + current token). */
export interface DeletionContext {
  ipAddress?: string;
  token?: string;
  tokenExp?: number; // ms
}

/**
 * User-facing copy for the "your account has been permanently deleted"
 * notification, sent from the single final deletion path (executeDeletion),
 * regardless of whether deletion was triggered by the user (immediate flow)
 * or by an admin approval (iOS flow).
 */
const ACCOUNT_DELETED_NOTIFICATION = {
  title: 'Account deleted',
  body: 'Your Laundrybrew account and associated personal data have been permanently deleted.',
  type: 'account_deleted',
} as const;

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly verificationTokenTtlMs = 10 * 60 * 1000; // 10 min
  private readonly retentionDays: number;

  /**
   * Whether to force identity re-verification (password/OTP) before deletion.
   * The user is already authenticated (valid JWT), so this defaults to OFF —
   * a logged-in user can delete directly. Set REQUIRE_DELETE_VERIFICATION=true
   * to re-enable the extra security step.
   */
  private readonly requireVerification: boolean;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly walletTxnModel: Model<WalletTransactionDocument>,
    private readonly repo: AccountDeletionRepository,
    private readonly identityService: IdentityVerificationService,
    private readonly notifications: NotificationsService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays = Number(
      this.configService.get('ACCOUNT_DELETION_RETENTION_DAYS') ?? 30,
    );
    this.requireVerification =
      String(this.configService.get('REQUIRE_DELETE_VERIFICATION') ?? 'false') ===
      'true';
  }

  // ── POST /account/delete/request ───────────────────────────────────────────

  async requestDelete(
    userId: string,
    dto: RequestDeleteDto,
    ctx: DeletionContext,
  ) {
    const user = await this.userModel
      .findById(userId)
      .select('name email mobileNumber isDeleted walletBalance')
      .lean();
    if (!user) throw new NotFoundException('User not found');
    if (user.isDeleted) {
      throw new ConflictException('Account is already deleted');
    }

    // Re-use an in-progress request instead of creating duplicates (covers a
    // parked PENDING_APPROVAL request too — see AccountDeletionRepository).
    const existing = await this.repo.findActiveByUser(userId);
    if (existing && existing.status !== DeleteRequestStatus.COMPLETED) {
      return this.activeRequestResult(existing, user.walletBalance ?? 0);
    }

    try {
      // ── iOS: admin-approval flow ─────────────────────────────────────────
      // The request is parked; the account is NOT touched (isDeleted stays
      // false, the user keeps full access) beyond flagging accountStatus so
      // the app can show a "Deletion Pending" state. An admin is notified and
      // is the only actor who can execute the deletion.
      if (dto.flow === DeletionFlow.ADMIN_APPROVAL) {
        const request = await this.repo.create({
          userId,
          userEmail: user.email,
          userMobile: user.mobileNumber,
          userName: user.name,
          reason: dto.reason,
          comment: dto.comment,
          status: DeleteRequestStatus.PENDING_APPROVAL,
        });

        await this.userModel.updateOne(
          { _id: userId },
          { $set: { accountStatus: AccountStatus.PENDING_DELETION } },
        );

        await this.repo.writeAudit(AuditAction.DELETE_REQUESTED, userId, {
          deleteRequestId: String(request._id),
          actor: 'USER',
          ipAddress: ctx.ipAddress,
          message: `Delete requested — awaiting admin approval (${dto.reason})`,
          meta: { flow: DeletionFlow.ADMIN_APPROVAL },
        });

        // Reuse the existing admin notification feed — no PII beyond the name,
        // which the admin delete-requests dashboard already shows.
        await this.notifications
          .notifyAdmin({
            title: 'Account deletion request',
            body: `${user.name ?? 'A user'} requested account deletion. Review it in Delete Requests.`,
            type: 'account_deletion_request',
          })
          .catch((e) =>
            this.logger.error(
              `notifyAdmin failed for delete request ${String(request._id)}: ${(e as Error).message}`,
            ),
          );

        return {
          ...this.toStatus(request),
          pendingApproval: true,
          verificationRequired: false,
          walletBalance: user.walletBalance ?? 0,
        };
      }

      // ── Android / Web: historical immediate flow (unchanged) ─────────────
      const request = await this.repo.create({
        userId,
        userEmail: user.email,
        userMobile: user.mobileNumber,
        userName: user.name,
        reason: dto.reason,
        comment: dto.comment,
        // When re-verification is disabled, the authenticated user can confirm
        // directly, so the request is created already VERIFIED.
        status: this.requireVerification
          ? DeleteRequestStatus.PENDING_VERIFICATION
          : DeleteRequestStatus.VERIFIED,
      });

      await this.repo.writeAudit(AuditAction.DELETE_REQUESTED, userId, {
        deleteRequestId: String(request._id),
        actor: 'USER',
        ipAddress: ctx.ipAddress,
        message: `Delete requested (${dto.reason})`,
      });

      return {
        ...this.toStatus(request),
        pendingApproval: false,
        verificationRequired: this.requireVerification,
        walletBalance: user.walletBalance ?? 0,
      };
    } catch (e) {
      // Lost the create race to a concurrent request (rapid taps / retries):
      // the partial unique index on DeleteRequest rejects the duplicate. Fold
      // it into the winning request — no second audit, no second admin
      // notification, no second accountStatus write.
      if ((e as { code?: number })?.code === 11000) {
        const active = await this.repo.findActiveByUser(userId);
        if (active) {
          return this.activeRequestResult(active, user.walletBalance ?? 0);
        }
      }
      throw e;
    }
  }

  /** Response shape when returning an already-open request (dedupe / race). */
  private activeRequestResult(request: any, walletBalance: number) {
    return {
      ...this.toStatus(request),
      pendingApproval:
        request.status === DeleteRequestStatus.PENDING_APPROVAL,
      verificationRequired:
        request.status === DeleteRequestStatus.PENDING_VERIFICATION,
      walletBalance,
    };
  }

  // ── Admin-approval flow: execute the deletion for a parked request ─────────

  /**
   * Runs the real, irreversible deletion for a request that was parked as
   * PENDING_APPROVAL. Only ever called by AccountDeletionAdminService.approve()
   * after an authenticated admin approves — never by the user. Delegates to the
   * exact same executeDeletion() mechanics as the immediate flow.
   */
  async executeApprovedDeletion(
    deleteRequestId: string,
    adminId: string,
  ): Promise<{ status: AccountStatus; deletedAt: Date; retentionUntil: Date }> {
    const request = await this.repo.findById(deleteRequestId);
    if (!request) throw new NotFoundException('Delete request not found');
    if (request.status !== DeleteRequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'This request is not awaiting approval',
      );
    }
    return this.executeDeletion(request.userId, request, {}, `ADMIN:${adminId}`);
  }

  // ── POST /account/delete/verify ────────────────────────────────────────────

  async verifyIdentity(
    userId: string,
    dto: VerifyDeleteDto,
    ctx: DeletionContext,
  ) {
    const request = await this.repo.findActiveByUser(userId);
    if (!request || request.status === DeleteRequestStatus.COMPLETED) {
      throw new NotFoundException('No pending delete request found');
    }

    const method = await this.identityService.verify(userId, dto);

    const verificationToken = crypto.randomBytes(32).toString('hex');
    await this.repo.update(String(request._id), {
      status: DeleteRequestStatus.VERIFIED,
      verificationMethod: method,
      verifiedAt: new Date(),
      verificationToken: this.hash(verificationToken),
      verificationTokenExpiresAt: new Date(
        Date.now() + this.verificationTokenTtlMs,
      ),
    });

    await this.repo.writeAudit(AuditAction.IDENTITY_VERIFIED, userId, {
      deleteRequestId: String(request._id),
      actor: 'USER',
      ipAddress: ctx.ipAddress,
      message: `Identity verified via ${method}`,
    });

    // The raw token is returned to the client and required by /confirm.
    return {
      verified: true,
      verificationToken,
      expiresInSeconds: this.verificationTokenTtlMs / 1000,
    };
  }

  // ── POST /account/delete/confirm ───────────────────────────────────────────

  async confirmDelete(
    userId: string,
    dto: ConfirmDeleteDto,
    ctx: DeletionContext,
  ) {
    const request = await this.repo.findActiveByUser(userId);
    if (!request || request.status === DeleteRequestStatus.COMPLETED) {
      throw new BadRequestException('No active delete request to confirm');
    }

    // A request parked for admin approval (iOS flow) can only be executed by
    // an admin — it must never be self-confirmable through this endpoint.
    if (request.status === DeleteRequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'This request is awaiting admin approval and cannot be confirmed here.',
      );
    }

    // Identity re-verification is only enforced when explicitly enabled.
    // The caller is already authenticated (valid JWT via JwtAuthGuard).
    if (this.requireVerification) {
      if (request.status !== DeleteRequestStatus.VERIFIED) {
        throw new BadRequestException(
          'Please verify your identity before confirming deletion',
        );
      }
      // Validate the single-use verification token.
      if (
        !dto.verificationToken ||
        !request.verificationToken ||
        request.verificationToken !== this.hash(dto.verificationToken) ||
        !request.verificationTokenExpiresAt ||
        request.verificationTokenExpiresAt.getTime() < Date.now()
      ) {
        throw new ForbiddenException(
          'Verification expired. Please verify again.',
        );
      }
    }

    const user = await this.userModel
      .findById(userId)
      .select('walletBalance isDeleted');
    if (!user) throw new NotFoundException('User not found');
    if (user.isDeleted) throw new ConflictException('Account already deleted');

    // There is no wallet withdrawal feature, so a non-zero balance must never
    // permanently block deletion (the user has to be able to complete it
    // in-app). The first confirm attempt surfaces the balance and asks for
    // explicit consent to forfeit it; only once given does deletion proceed.
    const walletBalance = user.walletBalance ?? 0;
    if (walletBalance > 0 && !dto.forfeitWalletBalance) {
      throw new BadRequestException({
        code: 'WALLET_BALANCE_REMAINING',
        walletBalance,
        message: `Your wallet holds ₹${walletBalance}. Spend it first, or confirm again to forfeit the remaining balance and continue deleting your account.`,
      });
    }

    return this.executeDeletion(userId, request, ctx, 'USER');
  }

  // ── The single, final deletion path ───────────────────────────────────────

  /**
   * Performs the irreversible account deletion: soft-delete + revoke every
   * session, forfeit any wallet balance, notify the user that deletion is
   * complete, clear device tokens, mark the request COMPLETED and write the
   * audit trail. This is the ONLY place the account is actually deleted; it is
   * reached from the immediate flow (confirmDelete, actor 'USER') and from the
   * admin-approval flow (executeApprovedDeletion, actor 'ADMIN:<id>').
   *
   * The wallet-balance consent check lives in confirmDelete, not here — by the
   * time this runs, forfeiture is unconditional (decision B: the iOS request
   * discloses it up front and the admin approval is the final consent).
   */
  private async executeDeletion(
    userId: string,
    request: any,
    ctx: DeletionContext,
    actor: 'USER' | `ADMIN:${string}`,
  ): Promise<{ status: AccountStatus; deletedAt: Date; retentionUntil: Date; message: string }> {
    const fresh = await this.userModel
      .findById(userId)
      .select('walletBalance isDeleted email mobileNumber');
    if (!fresh) throw new NotFoundException('User not found');

    const walletBalance = fresh.walletBalance ?? 0;
    const now = new Date();
    const retentionUntil = new Date(
      now.getTime() + this.retentionDays * 86_400_000,
    );

    // ── The one irreversible write ───────────────────────────────────────
    // Atomic + idempotent: conditional on `isDeleted != true`, so a retried
    // or double execution modifies 0 docs and we skip the one-time side
    // effects (wallet forfeit) while still driving the request to COMPLETED —
    // no dead-ends if a later best-effort step failed on a previous attempt.
    //
    // The unique identifiers (email / mobileNumber) and login credentials are
    // released HERE, not deferred to the retention-window cleanup job, so the
    // account can never again be logged into or found by registration, and the
    // same email/phone is immediately free for a brand-new account. They stay
    // captured on the DeleteRequest snapshot (userEmail/userMobile/userName)
    // for admin search + audit; the cleanup job still scrubs residual PII
    // (name, addresses, photo, cart, notifications) after the retention window.
    const upd = await this.userModel.updateOne(
      { _id: userId, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          accountStatus: AccountStatus.DELETED,
          deletedAt: now,
          deletedReason: request.reason,
          deletedReasonComment: request.comment ?? null,
          sessionsValidFrom: now, // invalidates all existing JWTs (all devices)
          walletBalance: 0,
        },
        $unset: {
          email: '',
          mobileNumber: '',
          password: '',
          passwordResetToken: '',
          passwordResetExpiresAt: '',
        },
      },
    );
    const firstRun = upd.modifiedCount === 1;

    // Make sure the request carries the identifiers we just removed from the
    // user, so admins can still search/trace this deletion afterwards.
    if (firstRun && (!request.userEmail || !request.userMobile)) {
      await this.repo
        .update(String(request._id), {
          userEmail: request.userEmail ?? fresh.email ?? null,
          userMobile: request.userMobile ?? fresh.mobileNumber ?? null,
        })
        .catch(() => undefined);
    }

    // Wallet forfeiture — once, only on the run that performed the delete.
    // The balance is already zeroed above; the ledger row + audit are the
    // durable record but must never strand the request if they fail.
    if (firstRun && walletBalance > 0) {
      try {
        await this.walletTxnModel.create({
          userId,
          type: WalletTxnType.DEBIT,
          amount: walletBalance,
          description: 'Wallet balance forfeited on account deletion',
          status: WalletTxnStatus.COMPLETED,
          category: WalletTxnCategory.DEBIT,
          openingBalance: walletBalance,
          closingBalance: 0,
          createdBy: 'SYSTEM',
        });
      } catch (e) {
        this.logger.error(
          `wallet-forfeit ledger write failed for ${userId}: ${(e as Error).message}`,
        );
      }
      await this.repo
        .writeAudit(AuditAction.WALLET_FORFEITED, userId, {
          deleteRequestId: String(request._id),
          actor,
          ipAddress: ctx.ipAddress,
          message: `Wallet balance of ₹${walletBalance} forfeited on account deletion`,
          meta: { walletBalance },
        })
        .catch(() => undefined);
    }

    // Tell the user their deletion is complete — the real "account deleted"
    // event, sent from this single final path. BEFORE removeAllTokens so the
    // push still has a device token to reach. Best-effort: we record whether it
    // was delivered rather than blocking / falsely implying success.
    let notified = false;
    if (firstRun) {
      try {
        await this.notifications.sendToUser(userId, {
          ...ACCOUNT_DELETED_NOTIFICATION,
        });
        notified = true;
      } catch (e) {
        this.logger.error(
          `account-deleted notification failed for ${userId}: ${(e as Error).message}`,
        );
      }
    }

    // Clear FCM/device tokens so no more pushes are sent.
    await this.notifications.removeAllTokens(userId).catch(() => undefined);

    // Blacklist the caller's current token immediately (this device only —
    // only present on the immediate flow; admin approval has no user token).
    if (ctx.token) this.tokenBlacklist.revoke(ctx.token, ctx.tokenExp);

    // Drop the cached "account active" status so other devices are locked out
    // within the cache TTL (the sessionsValidFrom set above is the durable gate).
    this.authService.clearAccountStatusCache(userId);

    await this.repo.update(String(request._id), {
      status: DeleteRequestStatus.COMPLETED,
      confirmedAt: now,
      retentionUntil,
      ...(actor.startsWith('ADMIN:')
        ? { adminId: actor.slice('ADMIN:'.length), processedAt: now }
        : {}),
      // token is single-use — invalidate it.
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });

    await this.repo
      .writeAudit(AuditAction.DELETE_CONFIRMED, userId, {
        deleteRequestId: String(request._id),
        actor,
        ipAddress: ctx.ipAddress,
        message:
          actor === 'USER'
            ? 'Account permanently deleted; identifiers released; sessions revoked'
            : 'Account permanently deleted after admin approval; identifiers released; sessions revoked',
        meta: {
          retentionUntil,
          notified,
          walletForfeited: firstRun && walletBalance > 0,
          idempotentReplay: !firstRun,
        },
      })
      .catch(() => undefined);
    await this.repo
      .writeAudit(AuditAction.SESSIONS_REVOKED, userId, {
        deleteRequestId: String(request._id),
        actor: 'SYSTEM',
      })
      .catch(() => undefined);

    return {
      status: AccountStatus.DELETED,
      deletedAt: now,
      retentionUntil,
      message:
        'Your account and personal data have been permanently deleted. '
        + 'Legally required records (e.g. tax invoices) are retained per our Privacy Policy.',
    };
  }

  // ── GET /account/delete/status ─────────────────────────────────────────────

  async getStatus(userId: string) {
    const [request, user] = await Promise.all([
      this.repo.findLatestByUser(userId),
      this.userModel.findById(userId).select('accountStatus isDeleted').lean(),
    ]);
    const accountStatus =
      user?.accountStatus ??
      (user?.isDeleted ? AccountStatus.DELETED : AccountStatus.ACTIVE);
    if (!request) return { hasRequest: false, accountStatus };
    return { hasRequest: true, accountStatus, ...this.toStatus(request) };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toStatus(request: any) {
    return {
      deleteRequestId: String(request._id),
      status: request.status,
      reason: request.reason,
      requestedAt: request.createdAt,
      confirmedAt: request.confirmedAt ?? null,
      retentionUntil: request.retentionUntil ?? null,
    };
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
