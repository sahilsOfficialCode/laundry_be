import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CouponDocument = Coupon & Document;

@Schema({ timestamps: true })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, index: true })
  code: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, enum: ['fixed', 'percentage'], default: 'fixed' })
  discountType: 'fixed' | 'percentage';

  @Prop({ required: true })
  discountAmount: number;

  @Prop()
  discountPercentage?: number;

  @Prop({ required: true, default: 0 })
  minOrderAmount: number;

  @Prop()
  maxRedemptions?: number;

  @Prop({ required: true, default: 0 })
  totalRedemptions: number;

  @Prop({ required: true })
  expiryDate: Date;

  @Prop({ required: true, default: true })
  isActive: boolean;

  @Prop({ default: null })
  createdBy?: string;

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt: Date;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

// Add index for faster queries
CouponSchema.index({ code: 1, isActive: 1 });
CouponSchema.index({ expiryDate: 1, isActive: 1 });
