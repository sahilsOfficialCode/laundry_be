import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { FraudReason } from '../enums/referral.enums';

export type FraudLogDocument = FraudLog & Document;

/**
 * Records every fraud signal raised while validating/applying a referral.
 * Kept separate from referral_logs so the fraud team can query independently
 * and so we retain signals even for referrals that were blocked before creation.
 */
@Schema({ timestamps: true })
export class FraudLog {
  @Prop({ required: false, default: null, index: true })
  referralId?: string;

  /** The user being evaluated (the referee/new account). */
  @Prop({ required: false, default: null, index: true })
  refereeId?: string;

  @Prop({ required: false, default: null, index: true })
  referrerId?: string;

  @Prop({ required: false, default: null, index: true })
  code?: string;

  @Prop({ type: [String], enum: FraudReason, required: true, index: true })
  reasons: FraudReason[];

  /** True when the signals were strong enough to auto-block. */
  @Prop({ default: false, index: true })
  blocked: boolean;

  // Fingerprints captured at evaluation time (for clustering duplicate accounts).
  @Prop({ required: false, default: null, index: true })
  deviceId?: string;
  @Prop({ required: false, default: null, index: true })
  ipAddress?: string;
  @Prop({ required: false, default: null })
  phone?: string;
  @Prop({ required: false, default: null })
  email?: string;

  @Prop({ type: Object, required: false, default: {} })
  meta?: Record<string, any>;
}

export const FraudLogSchema = SchemaFactory.createForClass(FraudLog);
