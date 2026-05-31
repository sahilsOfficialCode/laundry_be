import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LocationClosureDocument = LocationClosure & Document;

@Schema({ timestamps: true })
export class LocationClosure {
  @Prop({ required: true, index: true })
  locationId: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ required: false, trim: true })
  note?: string;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

export const LocationClosureSchema =
  SchemaFactory.createForClass(LocationClosure);

LocationClosureSchema.index({
  locationId: 1,
  startDate: 1,
  endDate: 1,
  isActive: 1,
});
