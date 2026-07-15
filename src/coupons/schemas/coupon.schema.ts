import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CouponDiscountType, CouponStatus } from '../enums/coupon.enums';

export type CouponDocument = Coupon & Document;

/**
 * A coupon is private by default — it only benefits users explicitly
 * assigned to it via CouponAssignment. See coupon-assignment.schema.ts.
 */
@Schema({ timestamps: true })
export class Coupon {
  // NOTE: uniqueness is enforced by the partial unique index below (scoped to
  // isDeleted: false), not here — a plain `unique: true` here would keep a
  // coupon code permanently reserved even after the coupon is soft-deleted.
  @Prop({ required: true, uppercase: true, trim: true })
  couponCode: string;

  @Prop({ required: true, trim: true })
  couponName: string;

  @Prop({ type: String, enum: CouponDiscountType, required: true, default: CouponDiscountType.FIXED })
  discountType: CouponDiscountType;

  /** Amount in ₹ (fixed) or percentage points (percentage). */
  @Prop({ required: true, min: 0 })
  discountValue: number;

  @Prop({ required: true, default: 0, min: 0 })
  minimumOrderAmount: number;

  /** Only meaningful for percentage coupons — caps the ₹ discount. */
  @Prop({ required: false, min: 0 })
  maximumDiscount?: number;

  /** How many times a single user may redeem this coupon. */
  @Prop({ required: true, default: 1, min: 1 })
  usagePerUser: number;

  /** Optional overall redemption cap across all assigned users. */
  @Prop({ required: false, min: 1 })
  totalUsageLimit?: number;

  /** Total successful redemptions across all users — incremented atomically on redemption. */
  @Prop({ required: true, default: 0, min: 0 })
  usedCount: number;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  expiryDate: Date;

  @Prop({ type: String, enum: CouponStatus, required: true, default: CouponStatus.ACTIVE, index: true })
  status: CouponStatus;

  @Prop({ required: false, default: '', trim: true, maxlength: 1000 })
  description?: string;

  /** Denormalized cache — count of active assignments. Kept in sync by the assignment service. */
  @Prop({ required: true, default: 0, min: 0 })
  assignedUsersCount: number;

  /** Denormalized cache — count of distinct users who have redeemed at least once. */
  @Prop({ required: true, default: 0, min: 0 })
  usedUsersCount: number;

  /** Running total of ₹ discount given across all redemptions — powers reports without re-aggregating. */
  @Prop({ required: true, default: 0, min: 0 })
  totalDiscountGiven: number;

  /** Admin userId who created this coupon. */
  @Prop({ required: true, index: true })
  createdBy: string;

  /** Admin userId who last updated this coupon. */
  @Prop({ required: false })
  updatedBy?: string;

  // ── Soft delete ────────────────────────────────────────────────────────
  @Prop({ required: true, default: false, index: true })
  isDeleted: boolean;

  @Prop({ type: Date, required: false, default: null })
  deletedAt?: Date | null;

  @Prop({ type: String, required: false, default: null })
  deletedBy?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

// Codes only need to be unique among *live* coupons — once a coupon is
// soft-deleted its code is freed up for reuse. A plain unique index would
// permanently reserve the code even after deletion.
CouponSchema.index(
  { couponCode: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
CouponSchema.index({ status: 1, expiryDate: 1, isDeleted: 1 });
CouponSchema.index({ createdAt: -1 });
