import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ServiceZoneDocument = ServiceZone & Document;

@Schema({ timestamps: true })
export class ServiceZone {
  @Prop({ required: true, trim: true })
  zoneName: string;

  @Prop({ required: false, trim: true })
  city?: string;

  @Prop({ required: true })
  centerLatitude: number;

  @Prop({ required: true })
  centerLongitude: number;

  /** Service coverage radius in kilometres (e.g. 3 = 3 km) */
  @Prop({ required: true, min: 0.1, max: 200 })
  radiusKm: number;

  @Prop({ required: true, default: true, index: true })
  isAvailable: boolean;
}

export const ServiceZoneSchema = SchemaFactory.createForClass(ServiceZone);

ServiceZoneSchema.index({ city: 1, isAvailable: 1 });
ServiceZoneSchema.index({ zoneName: 1 });
