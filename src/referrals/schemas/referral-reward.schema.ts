import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  RewardBeneficiary,
  RewardStatus,
  RewardType,
} from '../enums/referral.enums';

export type ReferralRewardDocument = ReferralReward & Document;

/**
 * A reward owed for a referral. There can be more than one reward per referral
 * (e.g. one for the referrer, one for the referee) and rewards move
 * independently through their own status.
 */
@Schema({ timestamps: true })
export class ReferralReward {
  @Prop({ required: true, index: true })
  referralId: string;

  /** User the reward will be credited to. */
  @Prop({ required: true, index: true })
  beneficiaryId: string;

  @Prop({ type: String, enum: RewardBeneficiary, required: true })
  beneficiaryType: RewardBeneficiary;

  @Prop({ type: String, enum: RewardType, required: true })
  rewardType: RewardType;

  /** Resolved payout amount in INR (or points count for POINTS type). */
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({
    type: String,
    enum: RewardStatus,
    default: RewardStatus.PENDING,
    index: true,
  })
  status: RewardStatus;

  /** Set for COUPON rewards. */
  @Prop({ required: false, default: null })
  couponCode?: string;

  /** Wallet transaction id created when the reward is released (audit trail). */
  @Prop({ required: false, default: null })
  walletTransactionId?: string;

  @Prop({ required: false, default: null })
  releasedAt?: Date;

  @Prop({ required: false, default: null })
  reversedAt?: Date;

  /** Reason for reversal/rejection, shown in history + admin timeline. */
  @Prop({ required: false, default: null })
  note?: string;
}

export const ReferralRewardSchema =
  SchemaFactory.createForClass(ReferralReward);

ReferralRewardSchema.index({ beneficiaryId: 1, status: 1, createdAt: -1 });
