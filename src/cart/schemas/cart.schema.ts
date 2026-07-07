import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CartDocument = Cart & Document;

@Schema({ _id: false })
class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'LaundryService', required: true })
  serviceId: Types.ObjectId;

  @Prop({ required: true })
  serviceNameSnapshot: string;

  @Prop({ required: true })
  unitPriceSnapshot: number;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  subtotal: number;

  /** 'instant' | 'scheduled' — which tab the user added this service from */
  @Prop({ required: false, default: 'instant' })
  category?: string;

  /** Snapshot of the service's turnaround hours at add-time (see LaundryService.turnaroundHours). */
  @Prop({ required: false, default: 24 })
  turnaroundHoursSnapshot?: number;
}

@Schema({ timestamps: true })
export class Cart {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ type: [CartItem], default: [] })
  items: CartItem[];

  @Prop({ default: 0 })
  totalAmount: number;
}

export const CartSchema = SchemaFactory.createForClass(Cart);
