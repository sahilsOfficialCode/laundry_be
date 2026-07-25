import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ServiceAvailabilityConfigDocument = ServiceAvailabilityConfig & Document;

const DEFAULT_INSTANT_CUTOFF = '20:00';

/**
 * Singleton config controlling whether Instant/Scheduled bookings are
 * accepted right now, and during what daily window. Seeded once on first
 * read (see ServiceAvailabilityService) — instantEndTime defaults to the
 * pre-existing INSTANT_ORDER_CUTOFF_TIME env var when set, so the very
 * first deploy of this config preserves whatever cutoff was already live.
 */
@Schema({ timestamps: true })
export class ServiceAvailabilityConfig {
  @Prop({ required: true, unique: true, default: 'GLOBAL' })
  key: string;

  @Prop({ default: true })
  instantEnabled: boolean;

  /** HH:MM 24h — Instant bookings accepted from this time... */
  @Prop({ default: '00:00' })
  instantStartTime: string;

  /** ...until this time. Defaults to the legacy INSTANT_ORDER_CUTOFF_TIME env var if set. */
  @Prop({ default: () => process.env.INSTANT_ORDER_CUTOFF_TIME?.trim() || DEFAULT_INSTANT_CUTOFF })
  instantEndTime: string;

  @Prop({ default: true })
  scheduledEnabled: boolean;

  /** HH:MM 24h — Scheduled bookings accepted from this time... */
  @Prop({ default: '00:00' })
  scheduledStartTime: string;

  /** ...until this time. Defaults to unrestricted (end of day). */
  @Prop({ default: '23:59' })
  scheduledEndTime: string;
}

export const ServiceAvailabilityConfigSchema = SchemaFactory.createForClass(ServiceAvailabilityConfig);
