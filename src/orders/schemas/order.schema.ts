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



  @Prop({ type: [{ serviceId: String, serviceName: String, icon: String, quantity: Number, price: Number, category: String }] })

  items: {

    serviceId: string;

    serviceName: string;

    icon?: string;

    quantity: number;

    price: number;

    /** 'instant' | 'scheduled' — which type the user ordered */

    category?: string;

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



  /** Delivery partner (userId with role delivery_partner) — set when status → OUT_FOR_DELIVERY */

  @Prop({ required: false, index: true })

  deliveryPartnerId?: string;



  /** Snapshot of the partner's name for display */

  @Prop({ required: false })

  deliveryPartnerName?: string;



  /** Weight in kg — set by admin when status → ITEMIZED */

  @Prop({ required: false })

  weightKg?: number;



  /** Item count — set by admin when status → ITEMIZED */

  @Prop({ required: false })

  itemCount?: number;



  /** Bill amount after itemization — may differ from original totalAmount */

  @Prop({ required: false })

  billAmount?: number;



  // ── Cloth-type breakdown for ITEMIZED workflow ────────────────────────────────

  @Prop({
    type: [
      {
        clothTypeId: { type: String, required: true },
        clothTypeName: { type: String, required: true },
        quantity: { type: Number, required: true },
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
    default: [],
  })

  clothTypeBreakdown?: {

    clothTypeId: string;

    clothTypeName: string;

    quantity: number;

    rate: number;

    amount: number;

  }[];



  /** Backend-calculated total from cloth-type breakdown */

  @Prop({ required: false })

  calculatedAmount?: number;



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



  // ── Order photos (uploaded by admin at collection/itemization) ────────────



  /**

   * Findings / damage evidence photos — taken by admin at pickup so there is

   * proof of pre-existing damage if the customer later complains.

   */

  @Prop({

    type: [

      {

        url: { type: String, required: true },

        imageId: String,

        note: String,

        uploadedAt: { type: Date, default: Date.now },

      },

    ],

    default: [],

  })

  damagePhotos: {

    _id?: any;

    url: string;

    imageId?: string;

    note?: string;

    uploadedAt: Date;

  }[];



  /**

   * Weighing / bill proof photos — scale reading uploaded with the bill so

   * the customer can verify the kg calculation.

   */

  @Prop({

    type: [

      {

        url: { type: String, required: true },

        imageId: String,

        uploadedAt: { type: Date, default: Date.now },

      },

    ],

    default: [],

  })

  weighingPhotos: {

    _id?: any;

    url: string;

    imageId?: string;

    uploadedAt: Date;

  }[];



  // ── Status history — one entry pushed every time status changes ────────────

  @Prop({

    type: [{ status: String, timestamp: Date }],

    default: [],

  })

  statusHistory: { status: string; timestamp: Date }[];

}



export const OrderSchema = SchemaFactory.createForClass(Order);



OrderSchema.index({ locationId: 1, pickupDate: 1, status: 1 });

