import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CouponAuditAction } from '../enums/coupon.enums';

export type CouponAuditLogDocument = CouponAuditLog & Document;

/**
 * Append-only audit trail for every administrative coupon action, per the
 * spec's Audit Logs section (admin id, action, timestamp, ip).
 */
@Schema({ timestamps: true })
export class CouponAuditLog {
  @Prop({ type: String, required: false, default: null, index: true })
  couponId?: string | null;

  @Prop({ type: String, required: false, default: null, index: true })
  couponCode?: string | null;

  @Prop({ type: String, enum: CouponAuditAction, required: true, index: true })
  action: CouponAuditAction;

  /** Admin userId who performed the action. */
  @Prop({ required: true, index: true })
  adminId: string;

  @Prop({ type: String, required: false, default: null })
  message?: string | null;

  @Prop({ type: String, required: false, default: null })
  ipAddress?: string | null;

  /** Arbitrary structured context — e.g. affected userIds, before/after fields. */
  @Prop({ type: Object, required: false, default: {} })
  meta?: Record<string, any>;

  createdAt?: Date;
}

export const CouponAuditLogSchema = SchemaFactory.createForClass(CouponAuditLog);

CouponAuditLogSchema.index({ couponId: 1, createdAt: -1 });
CouponAuditLogSchema.index({ adminId: 1, createdAt: -1 });
