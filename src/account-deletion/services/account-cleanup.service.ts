import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AccountDeletionRepository } from '../repositories/account-deletion.repository';
import {
  AccountStatus,
  AuditAction,
  DeleteRequestStatus,
} from '../enums/account-deletion.enums';
import { DeleteRequest } from '../schemas/delete-request.schema';

/**
 * Scheduled background job that anonymises personal data for accounts whose
 * retention window has elapsed. Retains legally-required records (orders,
 * payments, invoices, tax, fraud/audit logs) and only strips PII from the user.
 *
 * Uses a dependency-free interval scheduler (no @nestjs/schedule required).
 * The interval is configurable via ACCOUNT_CLEANUP_INTERVAL_MS (default 24h).
 */
@Injectable()
export class AccountCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly repo: AccountDeletionRepository,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this.configService.get('ACCOUNT_CLEANUP_INTERVAL_MS') ?? 24 * 60 * 60 * 1000,
    );
    // Kick off shortly after boot, then on a fixed interval.
    this.timer = setInterval(() => {
      this.runCleanup().catch((e) =>
        this.logger.error(`Cleanup run failed: ${(e as Error).message}`),
      );
    }, intervalMs);
    // Do not block startup; run one pass a minute after boot.
    setTimeout(() => this.runCleanup().catch(() => undefined), 60_000);
    this.logger.log(`Account cleanup scheduled every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Process every request whose retention window has elapsed. Returns count. */
  async runCleanup(): Promise<number> {
    const due = await this.repo.findDueForCleanup(new Date());
    let processed = 0;
    for (const request of due) {
      try {
        await this.anonymize(request);
        processed++;
      } catch (e) {
        this.logger.error(
          `Failed to anonymise request ${String(request._id)}: ${(e as Error).message}`,
        );
      }
    }
    if (processed > 0) this.logger.log(`Anonymised ${processed} account(s)`);
    return processed;
  }

  /**
   * Strip personal data from the user and mark the request CLEANED.
   * Exposed so an admin can trigger immediate cleanup (approve).
   */
  async anonymize(request: DeleteRequest & { _id: any }): Promise<void> {
    const userId = request.userId;
    const now = new Date();

    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          name: 'Deleted User',
          photoUrl: null,
          addresses: [],
          fcmTokens: [],
          deletedReasonComment: null,
          accountStatus: AccountStatus.ANONYMIZED,
          anonymizedAt: now,
        },
        // Remove unique PII so it cannot be linked back; sparse indexes tolerate absence.
        $unset: { email: '', mobileNumber: '' },
      },
    );

    await this.repo.update(String(request._id), {
      status: DeleteRequestStatus.CLEANED,
      cleanedAt: now,
    });

    await this.repo.writeAudit(AuditAction.DATA_ANONYMIZED, userId, {
      deleteRequestId: String(request._id),
      actor: 'SYSTEM',
      message: 'Personal data anonymised; legally-required records retained',
    });
  }
}
