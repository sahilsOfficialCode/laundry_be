import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Coupon, CouponDocument } from '../schemas/coupon.schema';
import { CouponEffectiveStatus, CouponStatus } from '../enums/coupon.enums';

/** Loose Mongoose filter shape (avoids depending on the FilterQuery type export — see referral.repository.ts). */
type FilterQuery<T> = Record<string, any>;

export interface ListCouponsFilter {
  search?: string;
  status?: CouponEffectiveStatus;
  expiryFrom?: string;
  expiryTo?: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

@Injectable()
export class CouponsRepository {
  constructor(
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
  ) {}

  get model(): Model<CouponDocument> {
    return this.couponModel;
  }

  async findByCode(code: string, includeDeleted = false): Promise<CouponDocument | null> {
    const filter: FilterQuery<CouponDocument> = { couponCode: code.toUpperCase() };
    if (!includeDeleted) filter.isDeleted = false;
    return this.couponModel.findOne(filter).lean();
  }

  async findById(id: string, includeDeleted = false): Promise<CouponDocument | null> {
    const filter: FilterQuery<CouponDocument> = { _id: id };
    if (!includeDeleted) filter.isDeleted = false;
    return this.couponModel.findOne(filter).lean();
  }

  async create(data: Partial<Coupon>): Promise<CouponDocument> {
    return this.couponModel.create(data);
  }

  async updateById(id: string, data: Partial<Coupon>): Promise<CouponDocument | null> {
    return this.couponModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, { $set: data }, { new: true })
      .lean();
  }

  async setStatus(id: string, status: CouponStatus, updatedBy: string): Promise<CouponDocument | null> {
    return this.couponModel
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $set: { status, updatedBy } },
        { new: true },
      )
      .lean();
  }

  async softDelete(id: string, deletedBy: string): Promise<CouponDocument | null> {
    return this.couponModel
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy } },
        { new: true },
      )
      .lean();
  }

  async list(filter: ListCouponsFilter): Promise<{ data: CouponDocument[]; total: number }> {
    const query: FilterQuery<CouponDocument> = { isDeleted: false };

    if (filter.search) {
      const re = new RegExp(this.escapeRegex(filter.search), 'i');
      query.$or = [{ couponCode: re }, { couponName: re }];
    }

    const now = new Date();
    if (filter.status === CouponEffectiveStatus.DISABLED) {
      query.status = CouponStatus.DISABLED;
    } else if (filter.status === CouponEffectiveStatus.EXPIRED) {
      query.status = CouponStatus.ACTIVE;
      query.expiryDate = { $lt: now };
    } else if (filter.status === CouponEffectiveStatus.ACTIVE) {
      query.status = CouponStatus.ACTIVE;
      query.expiryDate = { $gte: now };
    }

    if (filter.expiryFrom || filter.expiryTo) {
      query.expiryDate = {
        ...(query.expiryDate as object),
        ...(filter.expiryFrom ? { $gte: new Date(filter.expiryFrom) } : {}),
        ...(filter.expiryTo ? { $lte: new Date(filter.expiryTo) } : {}),
      };
    }

    const sort: Record<string, 1 | -1> = {
      [filter.sortBy]: filter.sortOrder === 'asc' ? 1 : -1,
    };

    const skip = (filter.page - 1) * filter.limit;

    const [data, total] = await Promise.all([
      this.couponModel.find(query).sort(sort).skip(skip).limit(filter.limit).lean(),
      this.couponModel.countDocuments(query),
    ]);

    return { data, total };
  }

  async incrementCounters(
    id: string,
    delta: { usedCount?: number; assignedUsersCount?: number; usedUsersCount?: number; totalDiscountGiven?: number },
  ): Promise<void> {
    const inc: Record<string, number> = {};
    for (const [k, v] of Object.entries(delta)) {
      if (v) inc[k] = v;
    }
    if (Object.keys(inc).length === 0) return;
    await this.couponModel.updateOne({ _id: id }, { $inc: inc });
  }

  async dashboardCounts(): Promise<{ active: number; expired: number; disabled: number; total: number }> {
    const now = new Date();
    const [active, expired, disabled, total] = await Promise.all([
      this.couponModel.countDocuments({ isDeleted: false, status: CouponStatus.ACTIVE, expiryDate: { $gte: now } }),
      this.couponModel.countDocuments({ isDeleted: false, status: CouponStatus.ACTIVE, expiryDate: { $lt: now } }),
      this.couponModel.countDocuments({ isDeleted: false, status: CouponStatus.DISABLED }),
      this.couponModel.countDocuments({ isDeleted: false }),
    ]);
    return { active, expired, disabled, total };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
