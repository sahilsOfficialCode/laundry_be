import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClothTypeDocument = ClothType & Document;

@Schema({ timestamps: true })
export class ClothType {
  // Not globally unique: the same garment name legitimately recurs across
  // different services (e.g. "Shirt" under both Ironing and Dry Cleaning).
  // Uniqueness is instead enforced per (name, category, subcategory) in
  // ClothTypesService, since that's the actual identity of a cloth type.
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  instantRate: number;

  @Prop({ required: true })
  scheduledRate: number;

  @Prop({ required: false })
  discountInstantRate?: number;

  @Prop({ required: false })
  discountScheduledRate?: number;

  @Prop({ required: false })
  description?: string;

  @Prop({ required: false })
  category?: string;

  @Prop({ required: false })
  subcategory?: string;

  @Prop({ required: true, default: true })
  isActive: boolean;

  @Prop({ type: [String], required: false })
  includes?: string[];

  @Prop({ type: [String], required: false })
  excludedItems?: string[];

  @Prop({ required: false })
  validityDays?: number;
}

export const ClothTypeSchema = SchemaFactory.createForClass(ClothType);
