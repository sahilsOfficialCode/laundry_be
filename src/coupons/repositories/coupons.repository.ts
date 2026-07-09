import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Coupon, CouponDocument } from '../schemas/coupon.schema';
import { CouponUsage, CouponUsageDocument } from '../schemas/coupon-usage.schema';

@Injectable()
export class CouponsRepository {
  constructor(
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @InjectModel(CouponUsage.name)
    private readonly usageModel: Model<CouponUsageDocument>,
  ) {}

  // ── Coupon queries ──────────────────────────────────────────────────────

  async findByCode(code: string): Promise<CouponDocument | null> {
    return this.couponModel.findOne({ code: code.toUpperCase() }).lean();
  }

  async findActiveCoupons(): Promise<CouponDocument[]> {
    return this.couponModel
      .find({
        isActive: true,
        expiryDate: { $gte: new Date() },
      })
      .lean();
  }

  async create(data: Partial<Coupon>): Promise<CouponDocument> {
    return this.couponModel.create(data);
  }

  async update(code: string, data: Partial<Coupon>): Promise<CouponDocument | null> {
    return this.couponModel
      .findOneAndUpdate(
        { code: code.toUpperCase() },
        { $set: { ...data, updatedAt: new Date() } },
        { new: true },
      )
      .lean();
  }

  async deactivate(code: string): Promise<CouponDocument | null> {
    return this.couponModel
      .findOneAndUpdate(
        { code: code.toUpperCase() },
        { $set: { isActive: false, updatedAt: new Date() } },
        { new: true },
      )
      .lean();
  }

  async getAllCoupons(): Promise<CouponDocument[]> {
    return this.couponModel.find().lean();
  }

  async incrementRedemptions(code: string): Promise<void> {
    await this.couponModel.updateOne(
      { code: code.toUpperCase() },
      { $inc: { totalRedemptions: 1 } },
    );
  }

  // ── Usage tracking ──────────────────────────────────────────────────────

  async recordUsage(
    couponCode: string,
    userId: string,
    orderId: string,
    discountAmount: number,
  ): Promise<CouponUsageDocument> {
    return this.usageModel.create({
      couponCode: couponCode.toUpperCase(),
      userId,
      orderId,
      discountAmount,
    });
  }

  async findUsageByOrder(orderId: string): Promise<CouponUsageDocument | null> {
    return this.usageModel.findOne({ orderId }).lean();
  }

  async getUserUsageCount(couponCode: string, userId: string): Promise<number> {
    return this.usageModel.countDocuments({
      couponCode: couponCode.toUpperCase(),
      userId,
    });
  }

  async getTotalUsageCount(couponCode: string): Promise<number> {
    return this.usageModel.countDocuments({
      couponCode: couponCode.toUpperCase(),
    });
  }
}
