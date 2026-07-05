import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ReferralLogAction } from '../enums/referral.enums';

export type ReferralLogDocument = ReferralLog & Document;

/**
 * Append-only audit trail for every meaningful referral event.
 * Powers the admin "referral timeline" view and satisfies audit requirements.
 */
@Schema({ timestamps: true })
export class ReferralLog {
  @Prop({ required: false, default: null, index: true })
  referralId?: string;

  @Prop({ type: String, enum: ReferralLogAction, required: true, index: true })
  action: ReferralLogAction;

  /** Actor: userId, 'ADMIN:<id>' or 'SYSTEM'. */
  @Prop({ required: true, default: 'SYSTEM' })
  actor: string;

  /** Human-readable message for the timeline. */
  @Prop({ required: false, default: null })
  message?: string;

  /** Arbitrary structured context (before/after status, amounts, etc.). */
  @Prop({ type: Object, required: false, default: {} })
  meta?: Record<string, any>;
}

export const ReferralLogSchema = SchemaFactory.createForClass(ReferralLog);

ReferralLogSchema.index({ referralId: 1, createdAt: -1 });
