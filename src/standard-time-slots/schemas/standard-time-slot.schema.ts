import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StandardTimeSlotDocument = StandardTimeSlot & Document;

export enum SlotType {
  PICKUP   = 'pickup',
  DELIVERY = 'delivery',
  BOTH     = 'both',
}

export const ALL_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday',
] as const;

export type DayOfWeek = typeof ALL_DAYS[number];

@Schema({ timestamps: true })
export class StandardTimeSlot {
  /** Human-readable label shown in the app, e.g. "Morning", "Evening" */
  @Prop({ required: true, trim: true })
  label: string;

  /** HH:MM 24h format, e.g. "09:00" */
  @Prop({ required: true })
  startTime: string;

  /** HH:MM 24h format, e.g. "12:00" */
  @Prop({ required: true })
  endTime: string;

  /** Whether this slot is for pickup, delivery, or both */
  @Prop({ enum: SlotType, required: true, default: SlotType.BOTH })
  type: SlotType;

  /** Days of the week this slot is available */
  @Prop({ type: [String], default: [...ALL_DAYS] })
  daysAvailable: DayOfWeek[];

  /** Max bookings allowed in this slot (null = unlimited) */
  @Prop({ required: false, min: 1 })
  capacity?: number;

  /** Admin-defined expected turnaround, e.g. "2–3 hrs" */
  @Prop({ required: false, trim: true })
  expectedTurnaround?: string;

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;

  /**
   * Grace-period support: when an admin deactivates a slot with a delay,
   * the slot remains visible to users until this timestamp (even though
   * isActive is already false). Null means no grace period is active.
   */
  @Prop({ required: false, default: null })
  effectiveUntil?: Date;

  /** Controls display order in the app (lower = first) */
  @Prop({ required: true, default: 0 })
  sortOrder: number;
}

export const StandardTimeSlotSchema = SchemaFactory.createForClass(StandardTimeSlot);
StandardTimeSlotSchema.index({ isActive: 1, sortOrder: 1 });
