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

  @Prop()
  razorpayOrderId?: string;

  @Prop()
  razorpayPaymentId?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
