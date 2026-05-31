import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrderDocument = Order & Document;
export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
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
  CANCELLED = 'CANCELLED',
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
  serviceType?: string;

  @Prop()
  assignedShopId?: string;

  @Prop()
  assignedShopName?: string;

  @Prop()
  assignedShopAddress?: string;

  @Prop()
  distanceKm?: number;

  @Prop({ type: Object })
  pickupAddress?: Record<string, unknown>;

  @Prop({ type: Object })
  receptionDetails?: Record<string, unknown>;

  @Prop({ type: Object })
  pickupSlot?: Record<string, unknown>;

  @Prop({ type: Object })
  deliverySlot?: Record<string, unknown>;

  @Prop()
  paymentMethod?: string;

  @Prop()
  paymentAttemptId?: string;

  @Prop()
  razorpayOrderId?: string;

  @Prop()
  razorpayPaymentId?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ userId: 1, paymentStatus: 1, razorpayOrderId: 1 });
OrderSchema.index({ assignedShopId: 1, 'pickupSlot.date': 1, 'pickupSlot.label': 1 });
OrderSchema.index({ assignedShopId: 1, 'deliverySlot.date': 1, 'deliverySlot.label': 1 });
