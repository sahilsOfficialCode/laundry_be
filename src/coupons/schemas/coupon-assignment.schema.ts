import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CouponAssignmentSource, CouponAssignmentStatus } from '../enums/coupon.enums';

export type CouponAssignmentDocument = CouponAssignment & Document;

/**
 * Who a coupon is privately visible to. A user can only validate/apply a
 * coupon if an ACTIVE row exists here for (couponId, userId) — this is what
 * makes the whole system "private by default".
 */
@Schema({ timestamps: true })
export class CouponAssignment {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Coupon', index: true })
  couponId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  /** Admin userId (or 'SYSTEM:<condition>' for bulk jobs) who created this assignment. */
  @Prop({ required: true })
  assignedBy: string;

  @Prop({ required: true, default: () => new Date() })
  assignedAt: Date;

  @Prop({ type: String, enum: CouponAssignmentSource, required: true, default: CouponAssignmentSource.MANUAL })
  source: CouponAssignmentSource;

  /** Which bulk condition produced this row, when source === BULK_CONDITION. */
  @Prop({ required: false })
  bulkCondition?: string;

  @Prop({ type: String, enum: CouponAssignmentStatus, required: true, default: CouponAssignmentStatus.ACTIVE, index: true })
  status: CouponAssignmentStatus;

  @Prop({ required: false })
  removedAt?: Date;

  @Prop({ required: false })
  removedBy?: string;

  /** How many times this user has redeemed this coupon — mirrors CouponRedemption count for fast usage-limit checks. */
  @Prop({ required: true, default: 0, min: 0 })
  usedCount: number;

  @Prop({ type: Date, required: false, default: null })
  lastUsedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponAssignmentSchema = SchemaFactory.createForClass(CouponAssignment);

// One assignment row per (coupon, user) — re-assigning reactivates the existing
// row instead of creating a duplicate, which also prevents duplicate-assignment races.
CouponAssignmentSchema.index({ couponId: 1, userId: 1 }, { unique: true });
CouponAssignmentSchema.index({ couponId: 1, status: 1 });
CouponAssignmentSchema.index({ userId: 1, status: 1 });
