import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrderPricingSnapshotDocument = OrderPricingSnapshot & Document;

export enum PricingSnapshotReason {
  ORDER_ESTIMATE = 'ORDER_ESTIMATE',
  ITEMIZED = 'ITEMIZED',
  ADMIN_OVERRIDE = 'ADMIN_OVERRIDE',
  PAYMENT_CAPTURED = 'PAYMENT_CAPTURED',
}

export class PricingLineItem {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, enum: ['auto', 'manual'] })
  kind: 'auto' | 'manual';

  @Prop({ required: false })
  category?: string;

  /** Set for per-service/per-cloth-type lines (category: 'service'). */
  @Prop({ required: false })
  quantity?: number;

  @Prop({ required: false })
  unit?: string;

  @Prop({ required: false })
  rate?: number;
}

export class PricingDiscountItem {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  source: 'coupon' | 'first_order' | 'referral' | 'promotion' | 'loyalty';
}

/**
 * Immutable, append-only pricing audit trail — one document per pricing
 * computation event for an order. Never updated in place; every checkout
 * estimate, itemization, admin override, and payment capture gets its own
 * snapshot so the full history of "what did we calculate and when" is always
 * reconstructable, independent of whatever the current Order document says.
 */
@Schema({ timestamps: true })
export class OrderPricingSnapshot {
  @Prop({ required: true, index: true })
  orderId: string;

  @Prop({ required: true, enum: PricingSnapshotReason })
  reason: PricingSnapshotReason;

  @Prop({
    type: [{ label: String, amount: Number, kind: String, category: String, quantity: Number, unit: String, rate: Number }],
    default: [],
  })
  lineItems: PricingLineItem[];

  @Prop({ required: true, default: 0 })
  itemsSubtotal: number;

  @Prop({ required: true, default: 0 })
  taxableSubtotal: number;

  @Prop({ required: true, default: 0 })
  taxRatePercent: number;

  @Prop({ required: true, default: 0 })
  taxAmount: number;

  @Prop({ required: true, default: 0 })
  deliveryFee: number;

  @Prop({ required: true, default: 0 })
  platformFee: number;

  @Prop({ required: true, default: 0 })
  convenienceFee: number;

  @Prop({ required: true, default: 0 })
  packagingFee: number;

  @Prop({ type: [{ label: String, amount: Number, source: String }], default: [] })
  discounts: PricingDiscountItem[];

  @Prop({ required: true, default: 0 })
  walletDeductionAmount: number;

  @Prop({ required: true, default: 0 })
  roundingAdjustment: number;

  @Prop({ required: true })
  payableTotal: number;

  @Prop({ default: false })
  isManualOverride: boolean;

  @Prop({ required: false })
  overrideReason?: string;

  /** adminId when produced by an admin action, 'SYSTEM' otherwise. */
  @Prop({ required: false, default: 'SYSTEM' })
  createdBy?: string;

  createdAt?: Date;
}

export const OrderPricingSnapshotSchema = SchemaFactory.createForClass(OrderPricingSnapshot);

OrderPricingSnapshotSchema.index({ orderId: 1, createdAt: -1 });
