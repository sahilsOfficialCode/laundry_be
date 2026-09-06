import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InvoiceDocument = Invoice & Document;

export class InvoiceLineItem {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, enum: ['auto', 'manual'] })
  kind: 'auto' | 'manual';
}

export class InvoiceDiscountItem {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  amount: number;
}

export class InvoiceItemSnapshot {
  @Prop({ required: true })
  name: string;

  /** Service name (e.g. "Wash & Fold", "Dry Cleaning") — copied from the order at invoice generation time, never re-fetched from ClothType. */
  @Prop({ required: false })
  serviceName?: string;

  /** Processing type this line was billed under — 'instant' | 'scheduled'. */
  @Prop({ required: false })
  serviceType?: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: false })
  unit?: string;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  amount: number;
}

/**
 * Immutable invoice document. Every value needed to render the PDF is
 * snapshotted at generation time (copied, never referenced live) so the
 * invoice renders byte-identical forever, even if the order's services,
 * cloth-type rates, or the customer's profile change afterward.
 */
@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true, index: true })
  orderId: string;

  @Prop({ required: true, unique: true, index: true })
  invoiceNumber: string;

  @Prop({ required: false })
  pricingSnapshotId?: string;

  @Prop({ required: false })
  orderNumber?: string;

  @Prop({ type: Object, required: false })
  customerSnapshot?: { name?: string; phone?: string; email?: string };

  @Prop({ required: false })
  billingAddressSnapshot?: string;

  @Prop({
    type: [{ name: String, serviceName: String, serviceType: String, quantity: Number, unit: String, rate: Number, amount: Number }],
    default: [],
  })
  itemsSnapshot: InvoiceItemSnapshot[];

  @Prop({ type: [{ label: String, amount: Number, kind: String }], default: [] })
  lineItems: InvoiceLineItem[];

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

  @Prop({ type: [{ label: String, amount: Number }], default: [] })
  discounts: InvoiceDiscountItem[];

  @Prop({ required: true, default: 0 })
  walletDeductionAmount: number;

  @Prop({ required: true, default: 0 })
  roundingAdjustment: number;

  @Prop({ required: true })
  payableTotal: number;

  @Prop({ required: false })
  paymentMethod?: string;

  @Prop({ required: false })
  razorpayPaymentId?: string;

  @Prop({ required: true })
  generatedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
