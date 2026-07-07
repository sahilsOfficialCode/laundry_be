import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ReferralStatus } from '../enums/referral.enums';

export type ReferralDocument = Referral & Document;

/**
 * A single referral relationship: one referrer invites one referee.
 * Exactly one referral row exists per referee (a user can only be referred once).
 */
@Schema({ timestamps: true })
export class Referral {
  /** User who owns the referral code (the inviter). */
  @Prop({ required: true, index: true })
  referrerId: string;

  /** Newly registered user who used the code. Unique → a referee is referred once. */
  @Prop({ required: true, unique: true, index: true })
  refereeId: string;

  /** The referral code that was used (denormalised for fast lookup/reporting). */
  @Prop({ required: true, index: true })
  code: string;

  /** Current lifecycle status. */
  @Prop({
    type: String,
    enum: ReferralStatus,
    default: ReferralStatus.PENDING,
    index: true,
  })
  status: ReferralStatus;

  /** The referee's first qualifying order (set when they place it). */
  @Prop({ required: false, default: null, index: true })
  qualifyingOrderId?: string;

  /** First order value — used for PERCENTAGE rewards and min-order checks. */
  @Prop({ required: false, default: null })
  firstOrderValue?: number;

  // ── Milestone timestamps (for analytics & timeline) ────────────────────────
  @Prop({ required: false, default: null })
  registeredAt?: Date;
  @Prop({ required: false, default: null })
  firstOrderAt?: Date;
  @Prop({ required: false, default: null })
  paymentCompletedAt?: Date;
  @Prop({ required: false, default: null })
  rewardReleasedAt?: Date;

  /** When this referral stops being eligible for a reward. */
  @Prop({ required: false, default: null, index: true })
  expiresAt?: Date;

  /** Populated when status = REJECTED. */
  @Prop({ required: false, default: null })
  rejectedReason?: string;

  // ── Anti-abuse fingerprints captured at apply time ─────────────────────────
  @Prop({ required: false, default: null, index: true })
  deviceId?: string;
  @Prop({ required: false, default: null, index: true })
  ipAddress?: string;

  /** Fraud engine verdict (true → flagged, may still be under review). */
  @Prop({ default: false, index: true })
  fraudSuspected: boolean;

  /** Snapshot of fraud reasons (enum values) for quick display. */
  @Prop({ type: [String], default: [] })
  fraudReasons: string[];
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

// Compound indexes for the most common queries.
ReferralSchema.index({ referrerId: 1, status: 1, createdAt: -1 });
ReferralSchema.index({ status: 1, expiresAt: 1 }); // expiry background job
