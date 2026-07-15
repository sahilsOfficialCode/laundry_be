import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CouponRedemption,
  CouponRedemptionDocument,
} from '../schemas/coupon-redemption.schema';

@Injectable()
export class CouponRedemptionsRepository {
  constructor(
    @InjectModel(CouponRedemption.name)
    private readonly model: Model<CouponRedemptionDocument>,
  ) {}

  async findByOrder(orderId: string): Promise<CouponRedemptionDocument | null> {
    return this.model.findOne({ orderId }).lean();
  }

  async create(
    data: {
      couponId: string;
      couponCode: string;
      userId: string;
      orderId: string;
      discountAmount: number;
    },
    session?: any,
  ): Promise<CouponRedemptionDocument> {
    const opts = session ? { session } : undefined;
    const [doc] = await this.model.create([{ ...data, redeemedAt: new Date() }], opts);
    return doc;
  }

  async countForUser(couponId: string, userId: string): Promise<number> {
    return this.model.countDocuments({ couponId, userId });
  }

  async listForCoupon(
    couponId: string,
    page: number,
    limit: number,
  ): Promise<{ data: CouponRedemptionDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model.find({ couponId }).sort({ redeemedAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments({ couponId }),
    ]);
    return { data, total };
  }

  async listAllForCoupon(couponId: string): Promise<CouponRedemptionDocument[]> {
    return this.model.find({ couponId }).sort({ redeemedAt: -1 }).lean();
  }
}
