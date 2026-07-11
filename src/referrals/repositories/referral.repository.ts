import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

/** Loose Mongoose filter shape (avoids depending on the FilterQuery type export). */
type Filter = Record<string, any>;
import { Referral, ReferralDocument } from '../schemas/referral.schema';
import {
  ReferralReward,
  ReferralRewardDocument,
} from '../schemas/referral-reward.schema';
import {
  ReferralLog,
  ReferralLogDocument,
} from '../schemas/referral-log.schema';
import { FraudLog, FraudLogDocument } from '../schemas/fraud-log.schema';
import {
  ReferralLogAction,
  ReferralStatus,
  RewardStatus,
} from '../enums/referral.enums';

/**
 * Data-access layer for the referral domain. Services depend on this
 * repository rather than touching Mongoose models directly, keeping the
 * persistence details in one place (clean architecture).
 */
@Injectable()
export class ReferralRepository {
  constructor(
    @InjectModel(Referral.name)
    private readonly referralModel: Model<ReferralDocument>,
    @InjectModel(ReferralReward.name)
    private readonly rewardModel: Model<ReferralRewardDocument>,
    @InjectModel(ReferralLog.name)
    private readonly logModel: Model<ReferralLogDocument>,
    @InjectModel(FraudLog.name)
    private readonly fraudModel: Model<FraudLogDocument>,
  ) {}

  // ── Referrals ──────────────────────────────────────────────────────────────

  createReferral(data: Partial<Referral>) {
    return this.referralModel.create(data);
  }

  findReferralById(id: string) {
    return this.referralModel.findById(id);
  }

  findReferralByReferee(refereeId: string) {
    return this.referralModel.findOne({ refereeId });
  }

  findReferrals(filter: Filter) {
    return this.referralModel.find(filter);
  }

  countReferrals(filter: Filter) {
    return this.referralModel.countDocuments(filter);
  }

  /** Paginated list for the referrer's history / admin table. */
  async paginateReferrals(
    filter: Filter,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.referralModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.referralModel.countDocuments(filter),
    ]);
    return { data, total };
  }

  updateReferral(id: string, update: Partial<Referral>) {
    return this.referralModel.findByIdAndUpdate(id, update, { new: true });
  }

  /**
   * Count a referrer's successful referrals since a given date — used for
   * daily/monthly/lifetime limit enforcement.
   */
  countSuccessfulSince(referrerId: string, since?: Date) {
    const filter: Filter = {
      referrerId,
      status: {
        $in: [
          ReferralStatus.FIRST_ORDER_COMPLETED,
          ReferralStatus.PAYMENT_COMPLETED,
          ReferralStatus.REWARD_RELEASED,
        ],
      },
    };
    if (since) filter.createdAt = { $gte: since };
    return this.referralModel.countDocuments(filter);
  }

  /** Referrals eligible for expiry (past window, not yet terminal). */
  findExpirable(now: Date) {
    return this.referralModel.find({
      expiresAt: { $lte: now },
      status: {
        $in: [
          ReferralStatus.PENDING,
          ReferralStatus.REGISTERED,
          ReferralStatus.FIRST_ORDER_COMPLETED,
        ],
      },
    });
  }

  // ── Rewards ────────────────────────────────────────────────────────────────

  createReward(data: Partial<ReferralReward>) {
    return this.rewardModel.create(data);
  }

  findRewardsByReferral(referralId: string) {
    return this.rewardModel.find({ referralId });
  }

  findRewardById(id: string) {
    return this.rewardModel.findById(id);
  }

  updateReward(id: string, update: Partial<ReferralReward>) {
    return this.rewardModel.findByIdAndUpdate(id, update, { new: true });
  }

  /**
   * Atomically transition a reward from `from` status, applying `update`.
   * Returns the updated document, or null if the reward was NOT in `from`
   * (i.e. another concurrent caller already claimed it). This is the
   * double-credit guard: only one caller can win the PENDING → RELEASED flip.
   */
  claimReward(id: string, from: RewardStatus, update: Record<string, any>) {
    return this.rewardModel.findOneAndUpdate(
      { _id: id, status: from },
      { $set: update },
      { new: true },
    );
  }

  aggregateRewards(pipeline: any[]) {
    return this.rewardModel.aggregate(pipeline);
  }

  // ── Audit + fraud logs ───────────────────────────────────────────────────

  writeLog(
    action: ReferralLogAction,
    opts: {
      referralId?: string;
      actor?: string;
      message?: string;
      meta?: Record<string, any>;
    } = {},
  ) {
    return this.logModel.create({
      action,
      actor: opts.actor ?? 'SYSTEM',
      referralId: opts.referralId,
      message: opts.message,
      meta: opts.meta ?? {},
    });
  }

  findLogs(referralId: string) {
    return this.logModel.find({ referralId }).sort({ createdAt: 1 }).lean();
  }

  writeFraudLog(data: Partial<FraudLog>) {
    return this.fraudModel.create(data);
  }

  countFraudLogs(filter: Filter = {}) {
    return this.fraudModel.countDocuments(filter);
  }

  // ── Aggregation passthrough (analytics) ────────────────────────────────────

  aggregateReferrals(pipeline: any[]) {
    return this.referralModel.aggregate(pipeline);
  }
}
