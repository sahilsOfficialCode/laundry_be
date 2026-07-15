import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CouponAssignment,
  CouponAssignmentDocument,
} from '../schemas/coupon-assignment.schema';
import { CouponAssignmentSource, CouponAssignmentStatus } from '../enums/coupon.enums';

/** Loose Mongoose filter shape (avoids depending on the FilterQuery type export — see referral.repository.ts). */
type FilterQuery<T> = Record<string, any>;

@Injectable()
export class CouponAssignmentsRepository {
  constructor(
    @InjectModel(CouponAssignment.name)
    private readonly assignmentModel: Model<CouponAssignmentDocument>,
  ) {}

  /** Exposed for CouponsService, which needs to run assignment updates inside a shared Mongo transaction session. */
  get model(): Model<CouponAssignmentDocument> {
    return this.assignmentModel;
  }

  async findActive(couponId: string, userId: string): Promise<CouponAssignmentDocument | null> {
    return this.model
      .findOne({ couponId, userId, status: CouponAssignmentStatus.ACTIVE })
      .lean();
  }

  async findAny(couponId: string, userId: string): Promise<CouponAssignmentDocument | null> {
    return this.model.findOne({ couponId, userId }).lean();
  }

  /**
   * Upsert-assign a batch of users to a coupon. Existing REMOVED rows are
   * reactivated (this is what powers "Reassign"); brand new rows are
   * created. Returns counts so the caller can update the coupon's
   * denormalized assignedUsersCount accurately (only genuinely-new actives
   * count, re-activating a removed row should too).
   */
  async assignMany(
    couponId: string,
    userIds: string[],
    assignedBy: string,
    source: CouponAssignmentSource,
    bulkCondition?: string,
  ): Promise<{ newlyAssigned: number; alreadyAssigned: number }> {
    if (userIds.length === 0) return { newlyAssigned: 0, alreadyAssigned: 0 };

    const existing = await this.model
      .find({ couponId, userId: { $in: userIds } })
      .select('userId status')
      .lean();
    const existingMap = new Map(existing.map((e) => [e.userId.toString(), e.status]));

    let newlyAssigned = 0;
    let alreadyAssigned = 0;
    const ops: any[] = [];

    for (const userId of userIds) {
      const currentStatus = existingMap.get(userId);
      if (currentStatus === CouponAssignmentStatus.ACTIVE) {
        alreadyAssigned++;
        continue;
      }
      newlyAssigned++;
      ops.push({
        updateOne: {
          filter: { couponId, userId },
          update: {
            $set: {
              status: CouponAssignmentStatus.ACTIVE,
              assignedBy,
              assignedAt: new Date(),
              source,
              bulkCondition: bulkCondition ?? null,
              removedAt: null,
              removedBy: null,
            },
            $setOnInsert: { usedCount: 0 },
          },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }

    return { newlyAssigned, alreadyAssigned };
  }

  async removeUser(couponId: string, userId: string, removedBy: string): Promise<CouponAssignmentDocument | null> {
    return this.model
      .findOneAndUpdate(
        { couponId, userId, status: CouponAssignmentStatus.ACTIVE },
        { $set: { status: CouponAssignmentStatus.REMOVED, removedAt: new Date(), removedBy } },
        { new: true },
      )
      .lean();
  }

  async countActive(couponId: string): Promise<number> {
    return this.model.countDocuments({ couponId, status: CouponAssignmentStatus.ACTIVE });
  }

  async incrementUsage(couponId: string, userId: string, session?: any): Promise<void> {
    const opts = session ? { session } : {};
    await this.model.updateOne(
      { couponId, userId },
      { $inc: { usedCount: 1 }, $set: { lastUsedAt: new Date() } },
      opts,
    );
  }

  async listForCoupon(
    couponId: string,
    filter: { search?: string; status?: 'active' | 'removed'; usage?: 'used' | 'unused'; page: number; limit: number },
    matchingUserIds?: string[] | null,
  ): Promise<{ data: CouponAssignmentDocument[]; total: number }> {
    const query: FilterQuery<CouponAssignmentDocument> = { couponId };
    if (filter.status) query.status = filter.status;
    if (filter.usage === 'used') query.usedCount = { $gt: 0 };
    if (filter.usage === 'unused') query.usedCount = 0;
    if (matchingUserIds) query.userId = { $in: matchingUserIds.map((id) => new Types.ObjectId(id)) };

    const skip = (filter.page - 1) * filter.limit;
    const [data, total] = await Promise.all([
      this.model.find(query).sort({ assignedAt: -1 }).skip(skip).limit(filter.limit).lean(),
      this.model.countDocuments(query),
    ]);
    return { data, total };
  }

  async listAllForCoupon(couponId: string): Promise<CouponAssignmentDocument[]> {
    return this.model.find({ couponId }).sort({ assignedAt: -1 }).lean();
  }
}
