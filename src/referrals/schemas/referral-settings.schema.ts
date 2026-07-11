import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { RewardType } from '../enums/referral.enums';

export type ReferralSettingsDocument = ReferralSettings & Document;

/**
 * Singleton configuration document controlling the whole referral programme.
 * A single row is seeded on first read (see ReferralSettingsService).
 */
@Schema({ timestamps: true })
export class ReferralSettings {
  /** Stable key so we can upsert the one-and-only settings row. */
  @Prop({ required: true, unique: true, default: 'GLOBAL' })
  key: string;

  /** Master on/off switch for the programme. */
  @Prop({ default: true })
  referralEnabled: boolean;

  /** Length of newly generated referral codes (existing codes are unaffected). */
  @Prop({ default: 7, min: 4, max: 12 })
  codeLength: number;

  // ── Reward configuration ───────────────────────────────────────────────────
  @Prop({ type: String, enum: RewardType, default: RewardType.WALLET_CREDIT })
  rewardType: RewardType;

  /** Reward amount (INR) for the REFERRER when the milestone is met. */
  @Prop({ default: 200, min: 0 })
  referrerRewardAmount: number;

  /** Optional welcome reward (INR) for the REFEREE. 0 disables it. */
  @Prop({ default: 50, min: 0 })
  refereeRewardAmount: number;

  /** For PERCENTAGE reward type: percent of first order value. */
  @Prop({ default: 0, min: 0, max: 100 })
  rewardPercentage: number;

  /** Minimum first-order value (INR) required to qualify. */
  @Prop({ default: 199, min: 0 })
  minimumOrderValue: number;

  /** Hard cap on a single reward payout (INR). 0 = uncapped. */
  @Prop({ default: 500, min: 0 })
  maximumReferralReward: number;

  // ── Expiry & limits ────────────────────────────────────────────────────────
  /** Days a referral stays eligible after the referee registers. */
  @Prop({ default: 30, min: 1 })
  referralExpiryDays: number;

  /** Max successful referrals allowed per referrer, per window. */
  @Prop({ default: 0, min: 0 }) // 0 = unlimited
  dailyLimit: number;
  @Prop({ default: 0, min: 0 })
  monthlyLimit: number;
  @Prop({ default: 0, min: 0 })
  lifetimeLimit: number;

  // ── Fraud toggles ──────────────────────────────────────────────────────────
  @Prop({ default: true })
  blockSameDevice: boolean;
  @Prop({ default: true })
  blockSameIp: boolean;
  @Prop({ default: false })
  vpnDetectionEnabled: boolean;

  // ── Notifications ──────────────────────────────────────────────────────────
  @Prop({ default: true })
  pushNotificationsEnabled: boolean;
  @Prop({ default: false })
  emailNotificationsEnabled: boolean;
}

export const ReferralSettingsSchema =
  SchemaFactory.createForClass(ReferralSettings);
