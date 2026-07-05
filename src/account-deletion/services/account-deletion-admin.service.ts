import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AccountDeletionRepository } from '../repositories/account-deletion.repository';
import { AccountCleanupService } from './account-cleanup.service';
import {
  AccountStatus,
  AuditAction,
  DeleteRequestStatus,
} from '../enums/account-deletion.enums';
import { DeleteHistoryQueryDto } from '../dto/account-deletion.dto';

/**
 * Admin-facing operations: browse/search delete requests, view timelines,
 * approve (force immediate anonymisation), reject (restore account), export,
 * and dashboard metrics.
 */
@Injectable()
export class AccountDeletionAdminService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly repo: AccountDeletionRepository,
    private readonly cleanupService: AccountCleanupService,
  ) {}

  // ── GET /admin/delete/history ──────────────────────────────────────────────

  async list(query: DeleteHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }
    if (query.search) {
      const s = query.search.trim();
      const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { userId: s },
        { userEmail: rx },
        { userMobile: rx },
        { userName: rx },
      ];
    }

    const { data, total } = await this.repo.paginate(filter, page, limit);
    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  getTimeline(deleteRequestId: string) {
    return this.repo.findAuditByRequest(deleteRequestId);
  }

  // ── POST /admin/delete/approve — force immediate anonymisation ─────────────

  async approve(deleteRequestId: string, adminId: string) {
    const request = await this.repo.findById(deleteRequestId);
    if (!request) throw new NotFoundException('Delete request not found');
    if (request.status !== DeleteRequestStatus.COMPLETED) {
      throw new NotFoundException(
        'Only completed (soft-deleted) requests can be finalised',
      );
    }

    await this.cleanupService.anonymize(request as any);
    await this.repo.update(deleteRequestId, {
      adminId,
      processedAt: new Date(),
    });
    await this.repo.writeAudit(AuditAction.CLEANUP_RAN, request.userId, {
      deleteRequestId,
      actor: `ADMIN:${adminId}`,
      message: 'Admin forced immediate anonymisation',
    });
    return { success: true };
  }

  // ── POST /admin/delete/reject — restore the account (if policy allows) ─────

  async reject(deleteRequestId: string, reason: string, adminId: string) {
    const request = await this.repo.findById(deleteRequestId);
    if (!request) throw new NotFoundException('Delete request not found');
    if (request.status === DeleteRequestStatus.CLEANED) {
      throw new NotFoundException(
        'Data already anonymised; account cannot be restored',
      );
    }

    // Restore the user account (data was only soft-deleted).
    await this.userModel.updateOne(
      { _id: request.userId },
      {
        $set: {
          isDeleted: false,
          isActive: true,
          accountStatus: AccountStatus.ACTIVE,
        },
        $unset: { deletedAt: '', deletedReason: '', deletedReasonComment: '' },
      },
    );

    await this.repo.update(deleteRequestId, {
      status: DeleteRequestStatus.REJECTED,
      adminId,
      rejectionReason: reason,
      processedAt: new Date(),
    });

    await this.repo.writeAudit(AuditAction.REQUEST_REJECTED, request.userId, {
      deleteRequestId,
      actor: `ADMIN:${adminId}`,
      message: reason || 'Rejected by admin',
    });
    await this.repo.writeAudit(AuditAction.ACCOUNT_RESTORED, request.userId, {
      deleteRequestId,
      actor: `ADMIN:${adminId}`,
      message: 'Account access restored (user must log in again)',
    });

    return { success: true };
  }

  // ── GET /admin/delete/dashboard ────────────────────────────────────────────

  async dashboard() {
    const [total, completed, pending, rejected, cleaned] = await Promise.all([
      this.repo.count(),
      this.repo.count({ status: DeleteRequestStatus.COMPLETED }),
      this.repo.count({
        status: {
          $in: [
            DeleteRequestStatus.PENDING_VERIFICATION,
            DeleteRequestStatus.VERIFIED,
          ],
        },
      }),
      this.repo.count({ status: DeleteRequestStatus.REJECTED }),
      this.repo.count({ status: DeleteRequestStatus.CLEANED }),
    ]);

    // Average processing time (request → confirm) over completed/cleaned.
    const avg = await this.repo.aggregate([
      {
        $match: {
          confirmedAt: { $ne: null },
        },
      },
      {
        $project: {
          durationMs: { $subtract: ['$confirmedAt', '$createdAt'] },
        },
      },
      { $group: { _id: null, avgMs: { $avg: '$durationMs' } } },
    ]);
    const avgProcessingMinutes = avg[0]?.avgMs
      ? Math.round(avg[0].avgMs / 60000)
      : 0;

    return {
      totalRequests: total,
      completed: completed + cleaned,
      pending,
      rejected,
      avgProcessingMinutes,
    };
  }
}
