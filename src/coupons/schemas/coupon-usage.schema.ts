import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CouponUsageDocument = CouponUsage & Document;

@Schema({ timestamps: true })
export class CouponUsage {
  @Prop({ required: true, uppercase: true, index: true })
  couponCode: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Order', index: true })
  orderId: Types.ObjectId;

  @Prop({ required: true })
  discountAmount: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const CouponUsageSchema = SchemaFactory.createForClass(CouponUsage);

// Compound index for efficient queries
CouponUsageSchema.index({ couponCode: 1, createdAt: -1 });
CouponUsageSchema.index({ userId: 1, createdAt: -1 });
CouponUsageSchema.index({ orderId: 1 });
