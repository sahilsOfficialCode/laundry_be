import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClothTypeDocument = ClothType & Document;

@Schema({ timestamps: true })
export class ClothType {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: false })
  description?: string;

  @Prop({ required: false })
  category?: string;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

export const ClothTypeSchema = SchemaFactory.createForClass(ClothType);
