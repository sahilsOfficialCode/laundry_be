import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LaundryServiceDocument = LaundryService & Document;

@Schema({ timestamps: true })
export class LaundryService {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  price!: number;

  @Prop({ required: true })
  description!: string;

  @Prop({ type: [String], default: [] })
  categories?: string[];

  @Prop({ required: false })
  duration?: string;

  /** Hours between pickup and delivery for scheduled orders of this service (e.g. 24, 48). Defaults to 24 when unset. */
  @Prop({ required: false, default: 24, min: 1 })
  turnaroundHours?: number;

  @Prop({ required: false })
  imageUrl?: string;

  @Prop({ required: true, default: true })
  isAvailable!: boolean;

  /** Marked by admin to appear in the "Popular Services" row on the home page. */
  @Prop({ default: false, index: true })
  isPopular?: boolean;

  /** Position of the card in the popular row (1 = first). Only relevant when isPopular. */
  @Prop({ required: false })
  popularOrder?: number;
}

export const LaundryServiceSchema = SchemaFactory.createForClass(LaundryService);