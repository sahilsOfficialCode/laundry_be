import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrderDocument = Order & Document;
export enum OrderStatus {
  ORDER_PLACED      = 'ORDER_PLACED',       // step 1 – Confirmed
  PICKUP_ASSIGNED   = 'PICKUP_ASSIGNED',    // step 2 – Driver on the way
  ITEMIZED          = 'ITEMIZED',           // step 3 – Items being weighed/counted
  PROCESSING        = 'PROCESSING',         // step 4 – Clothes being cleaned
  OUT_FOR_DELIVERY  = 'OUT_FOR_DELIVERY',   // step 5 – Delivered (awaiting OTP)
  COMPLETED         = 'COMPLETED',          // step 5 – OTP confirmed
  CANCELLED         = 'CANCELLED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: false, index: true })
  locationId?: string;

  @Prop({ type: Object, required: false })
  locationSnapshot?: {
    shopName?: string;
    fullAddress?: string;
    contactNumber?: string;
    city?: string;
  };

  @Prop({ type: [{ serviceId: String, serviceName: String, icon: String, quantity: Number, price: Number }] })
  items: { 
    serviceId: string; 
    serviceName: string; 
    icon?: string;
    quantity: number; 
    price: number; 
  }[];

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ enum: OrderStatus, default: OrderStatus.ORDER_PLACED })
  status: OrderStatus;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  paymentStatus: PaymentStatus;

  @Prop()
  address?: string;

  @Prop({ required: false })
  pickupDate?: Date;

  @Prop({ required: false })
  pickupSlot?: string;

  @Prop({ required: false })
  deliverySlot?: string;

  @Prop({ required: false })
  pickupTime?: string;

  @Prop({ type: [Number], required: false })
  pickupCoordinates?: [number, number];

  @Prop()
  razorpayOrderId?: string;

  /** Human-readable order number shown in the app, e.g. "LB20394" */
  @Prop({ unique: true, sparse: true })
  orderNumber?: string;

  @Prop()
  razorpayPaymentId?: string;

  // ── Tracking fields ────────────────────────────────────────────────────────

  /** Assigned driver name — set when status → PICKUP_ASSIGNED */
  @Prop({ required: false })
  driverName?: string;

  /** Assigned driver phone — set when status → PICKUP_ASSIGNED */
  @Prop({ required: false })
  driverPhone?: string;

  /** 4-digit OTP auto-generated when status → OUT_FOR_DELIVERY */
  @Prop({ required: false })
  deliveryOtp?: string;

  /** Weight in kg — set by admin when status → ITEMIZED */
  @Prop({ required: false })
  weightKg?: number;

  /** Item count — set by admin when status → ITEMIZED */
  @Prop({ required: false })
  itemCount?: number;

  /** Bill amount after itemization — may differ from original totalAmount */
  @Prop({ required: false })
  billAmount?: number;

  // ── Out-for-delivery live tracking ─────────────────────────────────────────

  /** ETA in minutes — set when status → OUT_FOR_DELIVERY */
  @Prop({ required: false })
  etaMinutes?: number;

  /** Driver distance from customer in km — updated when status → OUT_FOR_DELIVERY */
  @Prop({ required: false })
  driverDistanceKm?: number;

  // ── Post-delivery rating ───────────────────────────────────────────────────

  /** Star rating (1–5) — set by user after COMPLETED */
  @Prop({ required: false, min: 1, max: 5 })
  rating?: number;

  /** Optional review comment */
  @Prop({ required: false })
  ratingComment?: string;

  // ── Status history — one entry pushed every time status changes ────────────
  @Prop({
    type: [{ status: String, timestamp: Date }],
    default: [],
  })
  statusHistory: { status: string; timestamp: Date }[];

  // ── Washed clothes images ─────────────────────────────────────────────────
  @Prop({
    type: [
      {
        cloudflareId: { type: String, required: true },
        url: { type: String, required: true },
        thumbnailUrl: { type: String, required: false },
        uploadedBy: { type: String, required: true },
        uploadedAt: { type: Date, required: true },
      },
    ],
    default: [],
  })
  washedClothesImages: {
    cloudflareId: string;
    url: string;
    thumbnailUrl?: string;
    uploadedBy: string;
    uploadedAt: Date;
  }[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ locationId: 1, pickupDate: 1, status: 1 });
