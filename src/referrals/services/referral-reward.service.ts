import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryOptions } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnCategory,
  WalletTxnStatus,
  WalletTxnType,
} from '../../wallet/schemas/wallet-transaction.schema';
import { ReferralRepository } from '../repositories/referral.repository';
import { ReferralSettings } from '../schemas/referral-settings.schema';
import { Referral } from '../schemas/referral.schema';
import {
  ReferralLogAction,
  RewardBeneficiary,
  RewardStatus,
  RewardType,
} from '../enums/referral.enums';

/**
 * Owns the money side of referrals: computing reward amounts, creating reward
 * records, crediting/clawing-back the wallet, and keeping every movement logged.
 *
 * Wallet mutations use a MongoDB transaction so the balance increment and the
 * wallet_transaction insert either both succeed or both roll back.
 */
@Injectable()
export class ReferralRewardService {
  private readonly logger = new Logger(ReferralRewardService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly txnModel: Model<WalletTransactionDocument>,
    private readonly repo: ReferralRepository,
  ) {}

  /**
   * Resolve the payout amount for a referrer based on settings and (for
   * percentage rewards) the referee's first order value. Respects the cap.
   */
  computeAmount(
    settings: ReferralSettings,
    baseAmount: number,
    firstOrderValue?: number,
  ): number {
    let amount = baseAmount;
    if (
      settings.rewardType === RewardType.PERCENTAGE &&
      firstOrderValue &&
      settings.rewardPercentage > 0
    ) {
      amount = (firstOrderValue * settings.rewardPercentage) / 100;
    }
    if (settings.maximumReferralReward > 0) {
      amount = Math.min(amount, settings.maximumReferralReward);
    }
    return Math.round(amount * 100) / 100; // 2-dp
  }

  /**
   * Create PENDING reward records (referrer + optional referee) for a referral.
   *
   * `skipRefereeReward` — set when the referee already got their welcome bonus
   * as an instant checkout-time discount on this same order (see
   * OrdersService.resolveFirstOrderDiscount, which draws on the very same
   * refereeRewardAmount/minimumOrderValue/maximumReferralReward settings).
   * Without this the referee would be paid twice for one first order: once
   * off the bill, once again into their wallet. The referrer's own reward is
   * unaffected — they still earn it normally.
   */
  async createPendingRewards(
    referral: Referral & { _id: any },
    settings: ReferralSettings,
    opts: { skipRefereeReward?: boolean } = {},
  ): Promise<void> {
    const referralId = String(referral._id);

    const referrerAmount = this.computeAmount(
      settings,
      settings.referrerRewardAmount,
      referral.firstOrderValue,
    );
    if (referrerAmount > 0) {
      await this.repo.createReward({
        referralId,
        beneficiaryId: referral.referrerId,
        beneficiaryType: RewardBeneficiary.REFERRER,
        rewardType: settings.rewardType,
        amount: referrerAmount,
        status: RewardStatus.PENDING,
      });
    }

    if (settings.refereeRewardAmount > 0 && !opts.skipRefereeReward) {
      await this.repo.createReward({
        referralId,
        beneficiaryId: referral.refereeId,
        beneficiaryType: RewardBeneficiary.REFEREE,
        rewardType: settings.rewardType,
        amount: settings.refereeRewardAmount,
        status: RewardStatus.PENDING,
      });
    }
  }

  /**
   * Release all pending rewards for a referral → credit wallets atomically.
   * Idempotent: rewards already RELEASED are skipped.
   * @returns total amount credited across beneficiaries.
   */
  async releaseRewards(
    referralId: string,
    actor = 'SYSTEM',
  ): Promise<number> {
    const rewards = await this.repo.findRewardsByReferral(referralId);
    let totalCredited = 0;

    for (const reward of rewards) {
      if (reward.status !== RewardStatus.PENDING) continue;
      const rewardId = String(reward._id);

      if (reward.rewardType !== RewardType.WALLET_CREDIT &&
          reward.rewardType !== RewardType.FIXED_AMOUNT &&
          reward.rewardType !== RewardType.PERCENTAGE) {
        // Non-wallet rewards (coupon/points/free-delivery) are marked released
        // but handled by their own subsystems; no wallet movement here.
        await this.repo.claimReward(rewardId, RewardStatus.PENDING, {
          status: RewardStatus.RELEASED,
          releasedAt: new Date(),
        });
        continue;
      }

      // Atomic claim: only ONE caller can flip PENDING → RELEASED. A concurrent
      // release (double-tap, retry, admin + system race) gets null and skips —
      // this is what prevents a duplicate wallet credit.
      const claimed = await this.repo.claimReward(rewardId, RewardStatus.PENDING, {
        status: RewardStatus.RELEASED,
        releasedAt: new Date(),
      });
      if (!claimed) continue;

      try {
        const txnId = await this.creditWallet(
          reward.beneficiaryId,
          reward.amount,
          `Referral bonus`,
          referralId,
          actor,
        );
        claimed.walletTransactionId = txnId;
        await claimed.save();
        totalCredited += reward.amount;
      } catch (e) {
        // Credit failed → hand the claim back so a retry can release it.
        // The wallet transaction is atomic, so nothing was credited.
        await this.repo.claimReward(rewardId, RewardStatus.RELEASED, {
          status: RewardStatus.PENDING,
          releasedAt: null,
        });
        throw e;
      }
    }

    await this.repo.writeLog(ReferralLogAction.REWARD_RELEASED, {
      referralId,
      actor,
      message: `Released ₹${totalCredited} in referral rewards`,
      meta: { totalCredited },
    });

    return totalCredited;
  }

  /**
   * Reverse released rewards (refund/fraud discovered after payout).
   * Debits the wallet and flips reward status to REVERSED.
   */
  async reverseRewards(
    referralId: string,
    reason: string,
    actor = 'ADMIN',
  ): Promise<number> {
    const rewards = await this.repo.findRewardsByReferral(referralId);
    let totalReversed = 0;

    for (const reward of rewards) {
      if (reward.status !== RewardStatus.RELEASED) continue;

      // Atomic claim (RELEASED → REVERSED) so a double reverse can't debit twice.
      const claimed = await this.repo.claimReward(
        String(reward._id),
        RewardStatus.RELEASED,
        { status: RewardStatus.REVERSED, reversedAt: new Date(), note: reason },
      );
      if (!claimed) continue;

      try {
        await this.debitWallet(
          reward.beneficiaryId,
          reward.amount,
          `Referral reward reversed`,
          referralId,
          actor,
        );
        totalReversed += reward.amount;
      } catch (e) {
        // Debit failed → undo the claim so the reversal can be retried.
        await this.repo.claimReward(String(reward._id), RewardStatus.REVERSED, {
          status: RewardStatus.RELEASED,
          reversedAt: null,
          note: null,
        });
        throw e;
      }
    }

    await this.repo.writeLog(ReferralLogAction.REWARD_REVERSED, {
      referralId,
      actor,
      message: `Reversed ₹${totalReversed}: ${reason}`,
      meta: { totalReversed, reason },
    });

    return totalReversed;
  }

  // ── Wallet helpers (atomic via transaction) ───────────────────────────────

  /**
   * Credit a user's wallet and record a wallet_transaction in one transaction.
   * Returns the wallet transaction id.
   */
  private async creditWallet(
    userId: string,
    amount: number,
    description: string,
    referralId: string,
    actor = 'SYSTEM',
  ): Promise<string> {
    const buildTxnDoc = (closingBalance: number) => ({
      userId,
      type: WalletTxnType.CREDIT,
      amount,
      description,
      status: WalletTxnStatus.COMPLETED,
      referenceOrderId: `referral:${referralId}`, // legacy field, kept for BC
      referenceId: `referral:${referralId}`,
      category: WalletTxnCategory.REFERRAL_REWARD,
      openingBalance: Math.round((closingBalance - amount) * 100) / 100,
      closingBalance,
      createdBy: actor,
    });

    const applyCredit = async (session?: any): Promise<string> => {
      const opts: QueryOptions<UserDocument> = {
        new: true,
        select: 'walletBalance',
      };
      if (session) opts.session = session;
      const updated = await this.userModel.findOneAndUpdate(
        { _id: userId },
        { $inc: { walletBalance: amount } },
        opts,
      );
      const closing = updated?.walletBalance ?? amount;
      const doc = buildTxnDoc(closing);
      if (session) {
        const [txn] = await this.txnModel.create([doc], { session });
        return String(txn._id);
      }
      const txn = await this.txnModel.create(doc);
      return String(txn._id);
    };

    // Preferred: atomic transaction (requires a replica set).
    const session = await this.connection.startSession();
    try {
      let txnId = '';
      await session.withTransaction(async () => {
        txnId = await applyCredit(session);
      });
      return txnId;
    } catch (e) {
      if (!this.isTxnUnsupported(e)) throw e;
      // Fallback for standalone MongoDB (no transactions): sequential ops.
      return applyCredit();
    } finally {
      await session.endSession();
    }
  }

  /** Debit (clawback). Balance is floored at 0 to avoid going negative. */
  private async debitWallet(
    userId: string,
    amount: number,
    description: string,
    referralId: string,
    actor = 'ADMIN',
  ): Promise<void> {
    const applyDebit = async (session?: any) => {
      const q = this.userModel.findById(userId).select('walletBalance');
      const user = session ? await q.session(session) : await q;
      const current = user?.walletBalance ?? 0;
      const debit = Math.min(amount, current); // never negative

      const opts = session ? { session } : {};
      await this.userModel.updateOne(
        { _id: userId },
        { $inc: { walletBalance: -debit } },
        opts,
      );
      const doc = {
        userId,
        type: WalletTxnType.DEBIT,
        amount: debit,
        description,
        status: WalletTxnStatus.COMPLETED,
        referenceOrderId: `referral:${referralId}`, // legacy field, kept for BC
        referenceId: `referral:${referralId}`,
        category: WalletTxnCategory.DEBIT,
        openingBalance: current,
        closingBalance: Math.round((current - debit) * 100) / 100,
        createdBy: actor,
      };
      if (session) await this.txnModel.create([doc], { session });
      else await this.txnModel.create(doc);
    };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() => applyDebit(session));
    } catch (e) {
      if (!this.isTxnUnsupported(e)) throw e;
      await applyDebit(); // standalone fallback
    } finally {
      await session.endSession();
    }
  }

  /** True when the error is "transactions not supported on standalone". */
  private isTxnUnsupported(e: unknown): boolean {
    const msg = (e as Error)?.message ?? '';
    return (
      msg.includes('Transaction numbers are only allowed on a replica set') ||
      msg.includes('Transactions are not supported') ||
      msg.includes('replica set') ||
      msg.includes('mongos')
    );
  }
}
