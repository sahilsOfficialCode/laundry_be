import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrderDocument = Order & Document;
export enum OrderStatus {
  ORDER_PLACED = 'ORDER_PLACED',
  PICKUP_ASSIGNED = 'PICKUP_ASSIGNED',
  PROCESSING = 'PROCESSING',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
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

  @Prop()
  razorpayPaymentId?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ locationId: 1, pickupDate: 1, status: 1 });
