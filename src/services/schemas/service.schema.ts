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

  @Prop({ required: false })
  imageUrl?: string;

  @Prop({ required: true, default: true })
  isAvailable!: boolean;
}

export const LaundryServiceSchema = SchemaFactory.createForClass(LaundryService);