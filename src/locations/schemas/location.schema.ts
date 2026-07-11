import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LocationDocument = Location & Document;

export enum ServiceAreaType {
  RADIUS = 'radius',
  POLYGON = 'polygon',
}

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

@Schema({ _id: false })
export class DaySchedule {
  @Prop({ enum: DayOfWeek, required: true })
  day: DayOfWeek;

  @Prop({ required: true, default: true })
  isOpen: boolean;

  @Prop({ required: false })
  openTime?: string;

  @Prop({ required: false })
  closeTime?: string;
}

const DayScheduleSchema = SchemaFactory.createForClass(DaySchedule);

@Schema({ _id: false })
export class TimeSlot {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ required: false, min: 1 })
  capacity?: number;
}

const TimeSlotSchema = SchemaFactory.createForClass(TimeSlot);

@Schema({ timestamps: true })
export class Location {
  @Prop({ required: true, trim: true })
  shopName: string;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  fullAddress: string;

  @Prop({ required: false, trim: true })
  contactNumber?: string;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) =>
          Array.isArray(value) && value.length === 2,
        message: 'geoPoint.coordinates must contain [longitude, latitude]',
      },
    },
  })
  geoPoint: {
    type: 'Point';
    coordinates: [number, number];
  };

  @Prop({ enum: ServiceAreaType, required: true })
  serviceAreaType: ServiceAreaType;

  @Prop({ required: false, min: 0.5, max: 100 })
  serviceRadiusKm?: number;

  @Prop({
    type: {
      type: String,
      enum: ['Polygon'],
      required: false,
    },
    coordinates: {
      type: [[[Number]]],
      required: false,
    },
  })
  servicePolygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;

  @Prop({ required: false, default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ type: [DayScheduleSchema], default: [] })
  workingSchedule: DaySchedule[];

  @Prop({ type: [TimeSlotSchema], default: [] })
  pickupSlots: TimeSlot[];

  @Prop({ type: [TimeSlotSchema], default: [] })
  deliverySlots: TimeSlot[];

  /**
   * Maximum orders per day for this location.
   * Set to 0 for unlimited (no cap enforced).
   * Default 200 — set to 0 if you don't want any restriction.
   */
  @Prop({ required: true, min: 0, default: 0 })
  dailyBookingLimit: number;

  @Prop({ required: false, trim: true })
  pricingProfileKey?: string;

  @Prop({ type: [String], default: [] })
  supportedServiceIds: string[];

  @Prop({ type: [String], default: [] })
  enabledPaymentMethods: string[];
}

export const LocationSchema = SchemaFactory.createForClass(Location);

LocationSchema.index({ geoPoint: '2dsphere' });
LocationSchema.index({ servicePolygon: '2dsphere' }, { sparse: true });
LocationSchema.index({ city: 1, isActive: 1 });
LocationSchema.index({ shopName: 1 });
