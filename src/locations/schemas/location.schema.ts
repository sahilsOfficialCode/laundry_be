import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LocationDocument = Location & Document;
export type LocationClosureDocument = LocationClosure & Document;

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

export enum ServiceAreaType {
  RADIUS = 'radius',
  POLYGON = 'polygon',
}

export enum PaymentMethod {
  UPI = 'upi',
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  NET_BANKING = 'net_banking',
  WALLET = 'wallet',
  CASH_ON_DELIVERY = 'cash_on_delivery',
}

@Schema({ _id: false })
export class DaySchedule {
  @Prop({ enum: DayOfWeek, required: true })
  day: DayOfWeek;

  @Prop({ default: true })
  isOpen: boolean;

  @Prop()
  openTime?: string;

  @Prop()
  closeTime?: string;
}

@Schema({ _id: false })
export class TimeSlot {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ default: 0 })
  capacity?: number;
}

@Schema({ timestamps: true })
export class Location {
  @Prop({ required: true, trim: true })
  shopName: string;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  fullAddress: string;

  @Prop({ required: true, trim: true })
  contactNumber: string;

  @Prop({
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  })
  geoPoint: { type: 'Point'; coordinates: [number, number] };

  @Prop({ enum: ServiceAreaType, default: ServiceAreaType.RADIUS })
  serviceAreaType: ServiceAreaType;

  @Prop({ default: 8 })
  serviceRadiusKm?: number;

  @Prop({
    type: { type: String, enum: ['Polygon'], default: 'Polygon' },
    coordinates: { type: [[[Number]]], default: undefined },
  })
  servicePolygon?: { type: 'Polygon'; coordinates: number[][][] };

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ type: [DaySchedule], default: [] })
  workingSchedule: DaySchedule[];

  @Prop({ type: [TimeSlot], default: [] })
  pickupSlots: TimeSlot[];

  @Prop({ type: [TimeSlot], default: [] })
  deliverySlots: TimeSlot[];

  @Prop({ default: 200 })
  dailyBookingLimit: number;

  @Prop()
  pricingProfileKey?: string;

  @Prop({ type: [String], default: [] })
  supportedServiceIds: string[];

  @Prop({
    type: [String],
    enum: PaymentMethod,
    default: [
      PaymentMethod.UPI,
      PaymentMethod.CREDIT_CARD,
      PaymentMethod.DEBIT_CARD,
      PaymentMethod.NET_BANKING,
      PaymentMethod.WALLET,
    ],
  })
  enabledPaymentMethods: PaymentMethod[];
}

@Schema({ timestamps: true })
export class LocationClosure {
  @Prop({ required: true })
  locationId: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true })
  reason: string;

  @Prop()
  note?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const LocationSchema = SchemaFactory.createForClass(Location);
export const LocationClosureSchema = SchemaFactory.createForClass(LocationClosure);

LocationSchema.index({ geoPoint: '2dsphere' });
LocationSchema.index({ city: 1, isActive: 1 });
LocationClosureSchema.index({ locationId: 1, startDate: 1, endDate: 1 });
