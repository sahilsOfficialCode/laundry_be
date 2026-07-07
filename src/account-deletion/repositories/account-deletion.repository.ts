import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DeleteRequest,
  DeleteRequestDocument,
} from '../schemas/delete-request.schema';
import {
  AccountAuditLog,
  AccountAuditLogDocument,
} from '../schemas/account-audit-log.schema';
import {
  AuditAction,
  DeleteRequestStatus,
} from '../enums/account-deletion.enums';

type Filter = Record<string, any>;

/**
 * Data-access layer for delete requests + audit logs. Services depend on this
 * rather than touching Mongoose models directly (SOLID / separation of concerns).
 */
@Injectable()
export class AccountDeletionRepository {
  constructor(
    @InjectModel(DeleteRequest.name)
    private readonly requestModel: Model<DeleteRequestDocument>,
    @InjectModel(AccountAuditLog.name)
    private readonly auditModel: Model<AccountAuditLogDocument>,
  ) {}

  // ── Delete requests ────────────────────────────────────────────────────────

  create(data: Partial<DeleteRequest>) {
    return this.requestModel.create(data);
  }

  findById(id: string) {
    return this.requestModel.findById(id);
  }

  /** The user's current non-terminal request, if any. */
  findActiveByUser(userId: string) {
    return this.requestModel.findOne({
      userId,
      status: {
        $in: [
          DeleteRequestStatus.PENDING_VERIFICATION,
          DeleteRequestStatus.VERIFIED,
          DeleteRequestStatus.COMPLETED,
        ],
      },
    });
  }

  findLatestByUser(userId: string) {
    return this.requestModel.findOne({ userId }).sort({ createdAt: -1 });
  }

  update(id: string, update: Partial<DeleteRequest>) {
    return this.requestModel.findByIdAndUpdate(id, update, { new: true });
  }

  count(filter: Filter = {}) {
    return this.requestModel.countDocuments(filter);
  }

  aggregate(pipeline: any[]) {
    return this.requestModel.aggregate(pipeline);
  }

  /** Requests due for cleanup (retention window elapsed, still COMPLETED). */
  findDueForCleanup(now: Date) {
    return this.requestModel.find({
      status: DeleteRequestStatus.COMPLETED,
      retentionUntil: { $lte: now },
    });
  }

  async paginate(filter: Filter, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.requestModel.countDocuments(filter),
    ]);
    return { data, total };
  }

  // ── Audit logs ───────────────────────────────────────────────────────────

  writeAudit(
    action: AuditAction,
    userId: string,
    opts: {
      deleteRequestId?: string;
      actor?: string;
      message?: string;
      ipAddress?: string;
      meta?: Record<string, any>;
    } = {},
  ) {
    return this.auditModel.create({
      action,
      userId,
      actor: opts.actor ?? 'SYSTEM',
      deleteRequestId: opts.deleteRequestId,
      message: opts.message,
      ipAddress: opts.ipAddress,
      meta: opts.meta ?? {},
    });
  }

  findAuditByRequest(deleteRequestId: string) {
    return this.auditModel
      .find({ deleteRequestId })
      .sort({ createdAt: 1 })
      .lean();
  }
}
