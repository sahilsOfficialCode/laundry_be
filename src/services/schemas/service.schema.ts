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

  /** Shown to customers browsing/booking this service via the Instant (same-day) flow. */
  @Prop({ required: true })
  instantDescription!: string;

  /** Shown to customers browsing/booking this service via the Scheduled (time-slot) flow. */
  @Prop({ required: true })
  scheduledDescription!: string;

  /** Admin-authored message shown on the Order Placed screen for Instant bookings. */
  @Prop({ required: true })
  instantOrderPlacedMessage!: string;

  /** Admin-authored message shown on the Order Placed screen for Scheduled bookings. */
  @Prop({ required: true })
  scheduledOrderPlacedMessage!: string;

  @Prop({ type: [String], default: [] })
  categories?: string[];

  /** Estimated duration text shown to customers browsing the Instant (same-day) flow, e.g. "60-90 mins". Free text, not parsed. */
  @Prop({ required: false })
  instantDuration?: string;

  /** Estimated duration text shown to customers browsing the Scheduled (time-slot) flow, e.g. "24-48 hrs". Free text, not parsed. */
  @Prop({ required: false })
  scheduledDuration?: string;

  /** Hours between pickup and delivery for scheduled orders of this service (e.g. 24, 48). Defaults to 24 when unset. */
  @Prop({ required: false, default: 24, min: 1 })
  turnaroundHours?: number;

  /** Minutes between pickup and delivery for instant orders of this service (e.g. 60, 90). Defaults to 90 when unset. Mirrors turnaroundHours for Scheduled orders. */
  @Prop({ required: false, default: 90, min: 1 })
  instantTurnaroundMinutes?: number;

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