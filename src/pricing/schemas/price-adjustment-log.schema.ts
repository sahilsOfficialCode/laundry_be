import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PriceAdjustmentLogDocument = PriceAdjustmentLog & Document;

/**
 * Append-only audit trail for every admin price override on an order —
 * mirrors CouponAuditLog's shape (adminId, ip, reason, timestamps) so the
 * same "who changed money, when, why, from where" guarantee coupons already
 * have is extended to manual bill overrides.
 */
@Schema({ timestamps: true })
export class PriceAdjustmentLog {
  @Prop({ required: true, index: true })
  orderId: string;

  @Prop({ required: true })
  previousAmount: number;

  @Prop({ required: true })
  newAmount: number;

  @Prop({ required: true })
  diffAmount: number;

  @Prop({ required: true })
  reason: string;

  /** Admin userId who performed the override. */
  @Prop({ required: true, index: true })
  adminId: string;

  @Prop({ type: String, required: false, default: null })
  ipAddress?: string | null;

  @Prop({ type: Object, required: false, default: {} })
  meta?: Record<string, any>;

  createdAt?: Date;
}

export const PriceAdjustmentLogSchema = SchemaFactory.createForClass(PriceAdjustmentLog);

PriceAdjustmentLogSchema.index({ orderId: 1, createdAt: -1 });
PriceAdjustmentLogSchema.index({ adminId: 1, createdAt: -1 });
