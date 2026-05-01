import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LaundryServiceDocument = LaundryService & Document;

@Schema({ timestamps: true })
export class LaundryService {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  description: string;

  @Prop({ required: false })
  icon: string;

  @Prop({ required: true, default: true })
  isAvailable: boolean;
}

export const LaundryServiceSchema = SchemaFactory.createForClass(LaundryService);
