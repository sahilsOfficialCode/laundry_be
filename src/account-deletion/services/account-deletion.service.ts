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
import { NotificationsService } from '../../notifications/notifications.service';
import { TokenBlacklistService } from '../../auth/token-blacklist.service';
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
} from '../enums/account-deletion.enums';

/** Request context passed from the controller (ip + current token). */
export interface DeletionContext {
  ipAddress?: string;
  token?: string;
  tokenExp?: number; // ms
}

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
    private readonly repo: AccountDeletionRepository,
    private readonly identityService: IdentityVerificationService,
    private readonly notifications: NotificationsService,
    private readonly tokenBlacklist: TokenBlacklistService,
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

    // Re-use an in-progress request instead of creating duplicates.
    const existing = await this.repo.findActiveByUser(userId);
    if (existing && existing.status !== DeleteRequestStatus.COMPLETED) {
      return this.toStatus(existing);
    }

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
      verificationRequired: this.requireVerification,
      walletBalance: user.walletBalance ?? 0,
    };
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

    // Wallet may only be removed when empty — block if funds remain.
    if ((user.walletBalance ?? 0) > 0) {
      throw new BadRequestException(
        `Your wallet holds ₹${user.walletBalance}. Please spend or withdraw it before deleting your account.`,
      );
    }

    const now = new Date();
    const retentionUntil = new Date(
      now.getTime() + this.retentionDays * 86_400_000,
    );

    // ── Soft delete + revoke every session ────────────────────────────────
    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          accountStatus: AccountStatus.DELETED,
          deletedAt: now,
          deletedReason: request.reason,
          deletedReasonComment: request.comment ?? null,
          sessionsValidFrom: now, // invalidates all existing JWTs (all devices)
        },
      },
    );

    // Clear FCM/device tokens so no more pushes are sent.
    await this.notifications.removeAllTokens(userId).catch(() => undefined);

    // Blacklist the caller's current token immediately (this device).
    if (ctx.token) this.tokenBlacklist.revoke(ctx.token, ctx.tokenExp);

    await this.repo.update(String(request._id), {
      status: DeleteRequestStatus.COMPLETED,
      confirmedAt: now,
      retentionUntil,
      // token is single-use — invalidate it.
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });

    await this.repo.writeAudit(AuditAction.DELETE_CONFIRMED, userId, {
      deleteRequestId: String(request._id),
      actor: 'USER',
      ipAddress: ctx.ipAddress,
      message: 'Account soft-deleted; sessions revoked',
      meta: { retentionUntil },
    });
    await this.repo.writeAudit(AuditAction.SESSIONS_REVOKED, userId, {
      deleteRequestId: String(request._id),
      actor: 'SYSTEM',
    });

    return {
      status: AccountStatus.DELETED,
      deletedAt: now,
      retentionUntil,
      message:
        'Your account has been deleted. Personal data will be removed after the retention period.',
    };
  }

  // ── GET /account/delete/status ─────────────────────────────────────────────

  async getStatus(userId: string) {
    const request = await this.repo.findLatestByUser(userId);
    if (!request) return { hasRequest: false };
    return { hasRequest: true, ...this.toStatus(request) };
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
