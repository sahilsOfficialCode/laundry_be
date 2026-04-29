import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { LaundryService } from '../../services/schemas/service.schema';
import { User } from '../../users/schemas/user.schema';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PLACED = 'placed',
  PICKED_UP = 'picked_up',
  READY_FOR_PICKUP = 'ready_for_pickup',
  OUT_FOR_DELIVERY = 'out_for_delivery',
}

export const ORDER_STATUS_STAGES = [
  {
    status: OrderStatus.PLACED,
    label: 'Order placed',
  },
  {
    status: OrderStatus.PICKED_UP,
    label: 'Laundry picked up',
  },
  {
    status: OrderStatus.READY_FOR_PICKUP,
    label: 'Ready for pickup',
  },
  {
    status: OrderStatus.OUT_FOR_DELIVERY,
    label: 'Out for delivery',
  },
];

@Schema({ _id: false })
export class OrderItem {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: LaundryService.name,
    required: true,
  })
  serviceId: Types.ObjectId;

  @Prop({ required: true })
  serviceName: string;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ required: true, min: 1 })
  quantity: number;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
export class OrderStatusHistoryItem {
  @Prop({ enum: OrderStatus, required: true })
  status: OrderStatus;

  @Prop({ required: true })
  label: string;

  @Prop({ default: Date.now })
  changedAt: Date;
}

export const OrderStatusHistoryItemSchema = SchemaFactory.createForClass(
  OrderStatusHistoryItem,
);

@Schema({ timestamps: true })
export class Order {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: [OrderItemSchema], default: [] })
  items: OrderItem[];

  @Prop({ required: true, min: 0, default: 0 })
  totalAmount: number;

  @Prop({ enum: OrderStatus, default: OrderStatus.PLACED, index: true })
  status: OrderStatus;

  @Prop({ type: [OrderStatusHistoryItemSchema], default: [] })
  statusHistory: OrderStatusHistoryItem[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);
