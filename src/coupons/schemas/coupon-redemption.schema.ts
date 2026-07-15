import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CouponRedemptionDocument = CouponRedemption & Document;

/**
 * One row per successful redemption, written atomically (inside a Mongo
 * transaction alongside the usage-count increments) only when an order is
 * successfully paid — never at "apply" time. This is the audit trail behind
 * "Used Users" / "Total Discount Given" on the coupon details page.
 */
@Schema({ timestamps: true })
export class CouponRedemption {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Coupon', index: true })
  couponId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, index: true })
  couponCode: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Order', index: true, unique: true })
  orderId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  discountAmount: number;

  @Prop({ required: true, default: () => new Date() })
  redeemedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponRedemptionSchema = SchemaFactory.createForClass(CouponRedemption);

// One coupon redemption per order (an order carries at most one coupon).
CouponRedemptionSchema.index({ orderId: 1 }, { unique: true });
CouponRedemptionSchema.index({ couponId: 1, userId: 1, createdAt: -1 });
CouponRedemptionSchema.index({ couponId: 1, createdAt: -1 });
