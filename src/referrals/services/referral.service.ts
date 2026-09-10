import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReferralRepository } from '../repositories/referral.repository';
import { ReferralSettingsService } from './referral-settings.service';
import { FraudDetectionService } from './fraud-detection.service';
import { ReferralRewardService } from './referral-reward.service';
import {
  ReferralLogAction,
  ReferralStatus,
  RewardBeneficiary,
  RewardStatus,
} from '../enums/referral.enums';
import { ReferralDocument } from '../schemas/referral.schema';
import { ReferralSettings } from '../schemas/referral-settings.schema';
import { ApplyReferralDto } from '../dto/apply-referral.dto';
import { ReferralContext, ReferralHistoryItem } from '../types/referral.types';
import {
  generateReferralCode,
  isValidCodeFormat,
  normalizeCode,
} from '../utils/referral-code.util';

const LINK_BASE =
  process.env.REFERRAL_LINK_BASE || 'https://appname.com/register';

/**
 * Core orchestration for the Refer & Earn programme:
 * code lifecycle, validation, apply, milestone transitions, history and the
 * admin actions. Money movement is delegated to ReferralRewardService and
 * anti-abuse to FraudDetectionService.
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly repo: ReferralRepository,
    private readonly settingsService: ReferralSettingsService,
    private readonly fraudService: FraudDetectionService,
    private readonly rewardService: ReferralRewardService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Code generation (called from UsersService at registration) ─────────────

  /**
   * Generate a guaranteed-unique referral code. Retries on the (rare) collision.
   * Length comes from admin settings (codeLength) — no code change needed to
   * alter it. Returns the code; the caller stores it on the user document.
   */
  async generateUniqueCode(): Promise<string> {
    const settings = await this.settingsService.get();
    const length = settings.codeLength ?? 7;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateReferralCode(length);
      const exists = await this.userModel.exists({ referralCode: code });
      if (!exists) return code;
    }
    // Extremely unlikely — widen the space by adding chars.
    return generateReferralCode(length + 2);
  }

  buildReferralLink(code: string): string {
    return `${LINK_BASE}?ref=${encodeURIComponent(code)}`;
  }

  /** True when this user has already been referred (bound to a code). */
  async hasReferrer(userId: string): Promise<boolean> {
    const existing = await this.repo.findReferralByReferee(userId);
    return Boolean(existing);
  }

  /**
   * True when this user was referred and their referee welcome bonus is still
   * live — i.e. the referral programme (wallet credit on the first qualifying
   * order) is the channel for their ₹X, so OrdersService must NOT also hand
   * them the generic first-order discount off the bill. Referrals that can no
   * longer pay out (REJECTED / EXPIRED) return false, so those users still get
   * the ordinary first-order discount like any other new customer.
   */
  async refereeRewardApplies(userId: string): Promise<boolean> {
    const referral = await this.repo.findReferralByReferee(userId);
    if (!referral) return false;
    return ![ReferralStatus.REJECTED, ReferralStatus.EXPIRED].includes(
      referral.status,
    );
  }

  // ── First-order incentive (checkout-time discount) ─────────────────────────

  /**
   * Config the first-order discount is derived from — reuses the same
   * admin-configured referral settings shown on the "Refer & Earn" screen
   * (min. first order, max reward cap, welcome bonus for the friend) so
   * there's a single place admins tune both the referral welcome bonus and
   * the general first-order incentive.
   */
  async getFirstOrderIncentiveConfig(): Promise<{
    enabled: boolean;
    minimumOrderValue: number;
    rewardAmount: number;
    maxCap: number;
  }> {
    const settings = await this.settingsService.get();
    return {
      enabled: settings.referralEnabled && settings.refereeRewardAmount > 0,
      minimumOrderValue: settings.minimumOrderValue ?? 0,
      rewardAmount: settings.refereeRewardAmount ?? 0,
      maxCap: settings.maximumReferralReward ?? 0,
    };
  }

  // ── GET /referral/my ───────────────────────────────────────────────────────

  async getMyReferral(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('referralCode name')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    // Ensure legacy users (created before this feature) get a code lazily.
    let code = user.referralCode;
    if (!code) {
      code = await this.generateUniqueCode();
      await this.userModel.updateOne(
        { _id: userId },
        { $set: { referralCode: code } },
      );
    }

    const [total, released, pending] = await Promise.all([
      this.repo.countReferrals({ referrerId: userId }),
      this.repo.countReferrals({
        referrerId: userId,
        status: ReferralStatus.REWARD_RELEASED,
      }),
      this.repo.countReferrals({
        referrerId: userId,
        status: {
          $in: [
            ReferralStatus.PENDING,
            ReferralStatus.REGISTERED,
            ReferralStatus.FIRST_ORDER_COMPLETED,
            ReferralStatus.PAYMENT_COMPLETED,
          ],
        },
      }),
    ]);

    const earned = await this.repo.aggregateRewards([
      {
        $match: {
          beneficiaryId: userId,
          status: RewardStatus.RELEASED,
        },
      },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]);

    return {
      code,
      link: this.buildReferralLink(code),
      stats: {
        totalReferrals: total,
        successfulReferrals: released,
        pendingReferrals: pending,
        totalEarned: earned[0]?.sum ?? 0,
      },
    };
  }

  // ── POST /referral/validate ────────────────────────────────────────────────

  /**
   * Validate a code before/without applying. Does not mutate anything.
   * currentUserId (optional) lets us reject self-referral & already-referred.
   */
  async validateCode(rawCode: string, currentUserId?: string) {
    const settings = await this.settingsService.get();
    if (!settings.referralEnabled) {
      throw new ForbiddenException('Referral programme is currently disabled');
    }

    const code = normalizeCode(rawCode);
    if (!isValidCodeFormat(code)) {
      throw new BadRequestException('Invalid referral code format');
    }

    const referrer = await this.userModel
      .findOne({ referralCode: code })
      .select('_id name')
      .lean();
    if (!referrer) {
      throw new NotFoundException('Referral code not found');
    }

    if (currentUserId) {
      if (String(referrer._id) === currentUserId) {
        throw new BadRequestException('You cannot use your own referral code');
      }
      const already = await this.repo.findReferralByReferee(currentUserId);
      if (already) {
        throw new ConflictException('You have already used a referral code');
      }
    }

    return {
      valid: true,
      code,
      referrerName: referrer.name ?? 'A friend',
    };
  }

  // ── POST /referral/apply (during registration) ─────────────────────────────

  /**
   * Bind a referral code to the current (newly registered) user. Enforces all
   * the "only once / not self / not already referred" rules, runs the fraud
   * engine and per-referrer limits, then creates the referral in REGISTERED
   * state. Rewards remain PENDING until the referee completes a paid order.
   */
  async applyReferral(
    refereeId: string,
    dto: ApplyReferralDto,
    requestCtx: { ipAddress?: string } = {},
  ) {
    const settings = await this.settingsService.get();
    if (!settings.referralEnabled) {
      throw new ForbiddenException('Referral programme is currently disabled');
    }

    const code = normalizeCode(dto.code);
    if (!isValidCodeFormat(code)) {
      throw new BadRequestException('Invalid referral code format');
    }

    // A user can only ever use one referral code, once.
    const existing = await this.repo.findReferralByReferee(refereeId);
    if (existing) {
      throw new ConflictException('You have already used a referral code');
    }

    const referrer = await this.userModel
      .findOne({ referralCode: code })
      .select('_id')
      .lean();
    if (!referrer) throw new NotFoundException('Referral code not found');

    const referrerId = String(referrer._id);
    if (referrerId === refereeId) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    const context: ReferralContext = {
      deviceId: dto.deviceId,
      ipAddress: requestCtx.ipAddress,
      isEmulator: dto.isEmulator,
      isFakeGps: dto.isFakeGps,
      isVpn: dto.isVpn,
      phone: dto.phone,
      email: dto.email?.toLowerCase(),
    };

    // Fraud engine — auto-reject on any hard signal.
    const fraud = await this.fraudService.evaluate({
      referrerId,
      refereeId,
      code,
      context,
      settings,
    });

    // Per-referrer velocity limits.
    await this.assertWithinLimits(referrerId, settings);

    // Create the referral. If fraud fired, store it REJECTED with the reasons.
    // The unique index on refereeId is the last line of defence against two
    // concurrent apply calls: the loser gets E11000, which we surface as the
    // same "already used" conflict the earlier check produces.
    let referral;
    try {
      referral = await this.repo.createReferral({
        referrerId,
        refereeId,
        code,
        status: fraud.blocked ? ReferralStatus.REJECTED : ReferralStatus.REGISTERED,
        registeredAt: new Date(),
        expiresAt: new Date(
          Date.now() + settings.referralExpiryDays * 86_400_000,
        ),
        deviceId: dto.deviceId,
        ipAddress: requestCtx.ipAddress,
        fraudSuspected: fraud.blocked,
        fraudReasons: fraud.reasons,
        rejectedReason: fraud.blocked
          ? `Auto-rejected: ${fraud.reasons.join(', ')}`
          : undefined,
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('You have already used a referral code');
      }
      throw e;
    }

    await this.repo.writeLog(ReferralLogAction.APPLIED, {
      referralId: String(referral._id),
      actor: refereeId,
      message: fraud.blocked
        ? `Applied but auto-rejected (${fraud.reasons.join(', ')})`
        : 'Referral code applied',
      meta: { code, fraud: fraud.reasons },
    });

    if (fraud.blocked) {
      throw new ForbiddenException(
        'This referral could not be applied due to a policy check',
      );
    }

    // Notify the referrer that a friend joined.
    await this.notify(referrerId, settings, {
      title: 'You referred a friend! 🎉',
      body: 'Your friend just joined. Earn your reward when they complete their first order.',
      type: 'referral_registered',
    });

    return {
      success: true,
      referralId: String(referral._id),
      status: referral.status,
    };
  }

  // ── Milestone hook (called from OrdersService on a completed paid order) ───

  /**
   * Called when a referee's order reaches a terminal, paid, delivered state.
   * Applies the reward conditions and, if met, releases the reward.
   *
   * If the referral already qualified on an earlier call, this does NOT re-run
   * the milestone — but it DOES retry any reward that is still stuck PENDING
   * (e.g. a previous run credited the referrer and then died before the
   * referee's credit landed). That retry is what stops a half-released
   * referral from stranding the referee's welcome bonus forever.
   */
  async handleQualifyingOrder(
    refereeId: string,
    order: {
      _id: any;
      status: string;
      paymentStatus: string;
      billAmount?: number;
      totalAmount?: number;
      /** How much of the referee's welcome bonus was already given as an
       *  instant checkout-time discount on this order — credited-amount aware,
       *  so only the remainder (if any) becomes a wallet reward. */
      firstOrderDiscountAmount?: number;
    },
  ): Promise<void> {
    const referral = await this.repo.findReferralByReferee(refereeId);
    if (!referral) return; // user wasn't referred
    if (
      [ReferralStatus.REJECTED, ReferralStatus.EXPIRED].includes(referral.status)
    ) {
      return;
    }

    const settings = await this.settingsService.get();

    // Already qualified (or already released, e.g. via an admin action that
    // doesn't stamp qualifyingOrderId) — don't re-run the milestone or create
    // a second set of reward records; just finish releasing anything that is
    // somehow still pending.
    if (
      referral.qualifyingOrderId ||
      referral.status === ReferralStatus.REWARD_RELEASED
    ) {
      await this.releaseAndFinalize(referral, settings, { retryOnly: true });
      return;
    }

    // ── Reward conditions ─────────────────────────────────────────────────
    const orderValue = order.billAmount ?? order.totalAmount ?? 0;
    const delivered = order.status === 'COMPLETED';
    const paid = order.paymentStatus === 'COMPLETED';

    if (!delivered || !paid) return; // not cancelled/refunded, must be paid+delivered
    if (orderValue < settings.minimumOrderValue) return; // below threshold

    // Record the milestone.
    referral.qualifyingOrderId = String(order._id);
    referral.firstOrderValue = orderValue;
    referral.firstOrderAt = referral.firstOrderAt ?? new Date();
    referral.paymentCompletedAt = new Date();
    referral.status = ReferralStatus.PAYMENT_COMPLETED;
    await referral.save();

    await this.repo.writeLog(ReferralLogAction.STATUS_CHANGED, {
      referralId: String(referral._id),
      message: `Qualifying order completed (₹${orderValue})`,
      meta: { orderId: String(order._id), orderValue },
    });

    // Create the reward records now that we know the order value (for %).
    await this.rewardService.createPendingRewards(referral as any, settings, {
      refereeAlreadyCredited: order.firstOrderDiscountAmount ?? 0,
    });

    await this.releaseAndFinalize(referral, settings, { retryOnly: false });
  }

  /**
   * Release every still-PENDING reward for a referral and, only once nothing
   * remains pending, flip the referral to REWARD_RELEASED. Notifies each side
   * whose reward actually moved PENDING → RELEASED in this call (so a retry
   * that only finishes the referee's credit doesn't re-notify the referrer).
   *
   * Safe to call repeatedly — releaseRewards() skips rewards already RELEASED.
   */
  private async releaseAndFinalize(
    referral: ReferralDocument,
    settings: ReferralSettings,
    opts: { retryOnly: boolean },
  ): Promise<void> {
    const referralId = String(referral._id);

    const before = await this.repo.findRewardsByReferral(referralId);
    const wasPending = new Set<RewardBeneficiary>(
      before
        .filter((r) => r.status === RewardStatus.PENDING)
        .map((r) => r.beneficiaryType),
    );
    if (wasPending.size === 0) {
      // Nothing pending. Reconcile the referral status in case a prior partial
      // run released every reward but never flipped it to REWARD_RELEASED.
      await this.markReleasedIfComplete(referral, before);
      return;
    }
    if (opts.retryOnly) {
      this.logger.warn(
        `Referral ${referralId}: retrying ${wasPending.size} stranded PENDING reward(s)`,
      );
    }

    const credited = await this.rewardService.releaseRewards(
      referralId,
      'SYSTEM',
    );

    const after = await this.repo.findRewardsByReferral(referralId);
    const referrerReward = after.find(
      (r) => r.beneficiaryType === RewardBeneficiary.REFERRER,
    );
    const refereeReward = after.find(
      (r) => r.beneficiaryType === RewardBeneficiary.REFEREE,
    );

    if (
      wasPending.has(RewardBeneficiary.REFERRER) &&
      referrerReward?.status === RewardStatus.RELEASED
    ) {
      await this.notify(referral.referrerId, settings, {
        title: 'Referral reward credited! 💰',
        body: `₹${referrerReward.amount} has been added to your wallet.`,
        type: 'referral_reward_released',
      });
    }
    if (
      wasPending.has(RewardBeneficiary.REFEREE) &&
      refereeReward?.status === RewardStatus.RELEASED
    ) {
      await this.notify(referral.refereeId, settings, {
        title: 'Welcome bonus credited! 🎁',
        body: `₹${refereeReward.amount} has been added to your wallet.`,
        type: 'referral_reward_released',
      });
    }

    if (after.some((r) => r.status === RewardStatus.PENDING)) {
      // A credit still didn't land. Leave the referral in PAYMENT_COMPLETED so
      // the next qualifying-order hook or the reconcile sweep retries it —
      // don't claim REWARD_RELEASED.
      this.logger.error(
        `Referral ${referralId}: ${
          credited ? `credited ₹${credited}, but ` : ''
        }reward(s) still PENDING after release — will retry`,
      );
      return;
    }

    await this.markReleasedIfComplete(referral, after);
  }

  /** Flip a fully-released referral to REWARD_RELEASED (idempotent). */
  private async markReleasedIfComplete(
    referral: ReferralDocument,
    rewards: Array<{ status: RewardStatus }>,
  ): Promise<void> {
    const complete =
      rewards.length > 0 &&
      rewards.every((r) => r.status !== RewardStatus.PENDING);
    if (!complete) return;
    if (referral.status === ReferralStatus.REWARD_RELEASED) return;
    referral.status = ReferralStatus.REWARD_RELEASED;
    referral.rewardReleasedAt = referral.rewardReleasedAt ?? new Date();
    await referral.save();
  }

  /**
   * Safety-net sweep: finish releasing referral rewards that qualified but
   * whose wallet credit only partially landed (referrer paid, process died
   * before the referee's credit, transient DB error, ...). Idempotent and
   * cheap when there's nothing stranded. Returns how many referrals it fully
   * settled this run.
   */
  async reconcileStrandedRewards(limit = 100): Promise<number> {
    const referrals = await this.repo.findReferralsWithPendingRewards(limit);
    if (referrals.length === 0) return 0;

    const settings = await this.settingsService.get();
    let settled = 0;
    for (const referral of referrals) {
      try {
        await this.releaseAndFinalize(referral, settings, { retryOnly: true });
        const stillPending = (
          await this.repo.findRewardsByReferral(String(referral._id))
        ).some((r) => r.status === RewardStatus.PENDING);
        if (!stillPending) settled++;
      } catch (e) {
        this.logger.error(
          `reconcileStrandedRewards: referral ${String(referral._id)} failed: ${
            (e as Error).message
          }`,
        );
      }
    }
    this.logger.log(
      `reconcileStrandedRewards: ${settled}/${referrals.length} referral(s) settled`,
    );
    return settled;
  }

  // ── GET /referral/history ──────────────────────────────────────────────────

  async getHistory(userId: string, page = 1, limit = 20) {
    const { data, total } = await this.repo.paginateReferrals(
      { referrerId: userId },
      page,
      limit,
    );

    // Resolve referee names + reward amounts.
    const refereeIds = data.map((r) => r.refereeId);
    const users = await this.userModel
      .find({ _id: { $in: refereeIds } })
      .select('name')
      .lean();
    const nameMap = new Map(users.map((u) => [String(u._id), u.name]));

    const items: ReferralHistoryItem[] = [];
    for (const r of data) {
      const rewards = await this.repo.findRewardsByReferral(String(r._id));
      const referrerReward = rewards.find(
        (rw) => String(rw.beneficiaryId) === userId,
      );
      items.push({
        referralId: String(r._id),
        refereeName: nameMap.get(String(r.refereeId)) ?? 'Friend',
        joinedDate: r.registeredAt ?? null,
        status: r.status,
        rewardAmount: referrerReward?.amount ?? 0,
        rewardStatus: referrerReward?.status ?? RewardStatus.PENDING,
        releasedDate: referrerReward?.releasedAt ?? null,
        pendingReward:
          referrerReward && referrerReward.status === RewardStatus.PENDING
            ? referrerReward.amount
            : 0,
        rejectedReason: r.rejectedReason ?? null,
      });
    }

    return {
      data: items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Admin actions ──────────────────────────────────────────────────────────

  async adminRelease(referralId: string, adminId: string) {
    const referral = await this.repo.findReferralById(referralId);
    if (!referral) throw new NotFoundException('Referral not found');

    const settings = await this.settingsService.get();
    // Ensure rewards exist (e.g. manual release before auto-flow).
    const existingRewards = await this.repo.findRewardsByReferral(referralId);
    if (existingRewards.length === 0) {
      await this.rewardService.createPendingRewards(referral as any, settings);
    }

    const credited = await this.rewardService.releaseRewards(
      referralId,
      `ADMIN:${adminId}`,
    );
    referral.status = ReferralStatus.REWARD_RELEASED;
    referral.rewardReleasedAt = new Date();
    await referral.save();
    return { success: true, credited };
  }

  async adminReject(referralId: string, reason: string, adminId: string) {
    const referral = await this.repo.findReferralById(referralId);
    if (!referral) throw new NotFoundException('Referral not found');

    referral.status = ReferralStatus.REJECTED;
    referral.rejectedReason = reason || 'Rejected by admin';
    await referral.save();

    await this.repo.writeLog(ReferralLogAction.REJECTED, {
      referralId,
      actor: `ADMIN:${adminId}`,
      message: referral.rejectedReason,
    });
    await this.notify(referral.referrerId, await this.settingsService.get(), {
      title: 'Referral rejected',
      body: 'One of your referrals could not be approved.',
      type: 'referral_rejected',
    });
    return { success: true };
  }

  async adminReverse(referralId: string, reason: string, adminId: string) {
    const referral = await this.repo.findReferralById(referralId);
    if (!referral) throw new NotFoundException('Referral not found');

    const reversed = await this.rewardService.reverseRewards(
      referralId,
      reason || 'Reversed by admin',
      `ADMIN:${adminId}`,
    );
    referral.status = ReferralStatus.REJECTED;
    referral.rejectedReason = reason || 'Reward reversed by admin';
    await referral.save();
    return { success: true, reversed };
  }

  /** Admin "hold" — parks a referral back in REGISTERED pending review. */
  async adminHold(referralId: string, adminId: string) {
    const referral = await this.repo.findReferralById(referralId);
    if (!referral) throw new NotFoundException('Referral not found');
    referral.status = ReferralStatus.REGISTERED;
    await referral.save();
    await this.repo.writeLog(ReferralLogAction.STATUS_CHANGED, {
      referralId,
      actor: `ADMIN:${adminId}`,
      message: 'Referral placed on hold',
    });
    return { success: true };
  }

  async getTimeline(referralId: string) {
    return this.repo.findLogs(referralId);
  }

  // ── Background expiry (called by a cron job) ───────────────────────────────

  async expireStaleReferrals(): Promise<number> {
    const now = new Date();
    const stale = await this.repo.findExpirable(now);
    let count = 0;
    for (const r of stale) {
      r.status = ReferralStatus.EXPIRED;
      await r.save();
      await this.repo.writeLog(ReferralLogAction.EXPIRED, {
        referralId: String(r._id),
        message: 'Referral expired before qualifying',
      });
      count++;
    }
    if (count) this.logger.log(`Expired ${count} stale referrals`);
    return count;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async assertWithinLimits(
    referrerId: string,
    settings: { dailyLimit: number; monthlyLimit: number; lifetimeLimit: number },
  ): Promise<void> {
    const now = new Date();
    if (settings.dailyLimit > 0) {
      const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const c = await this.repo.countSuccessfulSince(referrerId, since);
      if (c >= settings.dailyLimit)
        throw new ForbiddenException('Daily referral limit reached');
    }
    if (settings.monthlyLimit > 0) {
      const since = new Date(now.getFullYear(), now.getMonth(), 1);
      const c = await this.repo.countSuccessfulSince(referrerId, since);
      if (c >= settings.monthlyLimit)
        throw new ForbiddenException('Monthly referral limit reached');
    }
    if (settings.lifetimeLimit > 0) {
      const c = await this.repo.countSuccessfulSince(referrerId);
      if (c >= settings.lifetimeLimit)
        throw new ForbiddenException('Lifetime referral limit reached');
    }
  }

  private async notify(
    userId: string,
    settings: { pushNotificationsEnabled: boolean },
    payload: { title: string; body: string; type: string },
  ): Promise<void> {
    if (!settings.pushNotificationsEnabled) return;
    try {
      await this.notifications.sendToUser(userId, payload);
    } catch (e) {
      this.logger.warn(`Referral notification failed: ${(e as Error).message}`);
    }
  }
}
