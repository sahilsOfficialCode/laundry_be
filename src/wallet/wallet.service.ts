import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnCategory,
  WalletTxnType,
  WalletTxnStatus,
  VISIBLE_WALLET_TXN_STATUSES,
} from './schemas/wallet-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
  PaymentStatus,
} from '../orders/schemas/order.schema';
import { PaymentsService } from '../payments/payments.service';
import { CreateAddMoneyOrderDto, VerifyAddMoneyDto } from './dto/add-money.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { CouponsService } from '../coupons/services/coupons.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentEvent, PaymentEventDocument, PaymentEventOutcome, PaymentEventSource } from '../payments/schemas/payment-event.schema';
import { logPaymentEvent } from '../payments/payment-event-logger.util';
import { PaymentMetricsService } from '../payments/payment-metrics.service';
import { PaymentAlertsService } from '../payments/payment-alerts.service';

export interface ApplyTopUpCapturedInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  /** Captured amount in paise, when the caller has it (webhook/reconciliation). Verify doesn't supply one — the wallet's own Razorpay order was already minted server-side for this exact txn.amount, so signature validity is sufficient there. */
  amountPaise?: number;
  eventType: string;
  source: PaymentEventSource;
  razorpayEventId?: string;
  requestId?: string;
  traceId?: string;
  rawPayload?: Record<string, any>;
}

export interface ApplyTopUpCapturedResult {
  applied: boolean;
  txn: WalletTransactionDocument | null;
  outcome: PaymentEventOutcome;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(WalletTransaction.name)
    private readonly txnModel: Model<WalletTransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(PaymentEvent.name)
    private readonly paymentEventModel: Model<PaymentEventDocument>,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly couponsService: CouponsService,
    private readonly invoicesService: InvoicesService,
    private readonly metrics: PaymentMetricsService,
    private readonly alerts: PaymentAlertsService,
  ) {}

  // ── GET /wallet ────────────────────────────────────────────────────────────

  async getWallet(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('walletBalance')
      .lean();

    const transactions = await this.txnModel
      .find({ userId, status: { $in: VISIBLE_WALLET_TXN_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return {
      balance: user?.walletBalance ?? 0,
      transactions,
    };
  }

  // ── GET /wallet/transactions ────────────────────────────────────────────────

  // Pending transactions are an internal in-flight state (awaiting Razorpay
  // callback/webhook) — they aren't a settled ledger entry yet, so they're
  // excluded from every user-facing wallet view (list, "recent", and any
  // future summary), not just this endpoint. Failed transactions ARE shown
  // (per product decision) so users can see why a top-up didn't land.
  async getAllTransactions(userId: string) {
    const transactions = await this.txnModel
      .find({ userId, status: { $in: VISIBLE_WALLET_TXN_STATUSES } })
      .sort({ createdAt: -1 })
      .lean();

    return { transactions };
  }

  // ── POST /wallet/add-money/create-order ────────────────────────────────────

  async createAddMoneyOrder(userId: string, dto: CreateAddMoneyOrderDto) {
    const { amount } = dto;

    if (amount < 1 || amount > 100000) {
      throw new BadRequestException('Amount must be between ₹1 and ₹1,00,000');
    }

    // Create a PENDING wallet transaction before opening Razorpay.
    const txn = await this.txnModel.create({
      userId,
      type: WalletTxnType.CREDIT,
      amount,
      description: `Wallet top-up of ₹${amount}`,
      status: WalletTxnStatus.PENDING,
      category: WalletTxnCategory.TOPUP,
      createdBy: 'USER',
    });

    // Create a Razorpay order; use wallet_<txnId> as receipt.
    const razorpayOrder = await this.paymentsService.createOrder(
      amount,
      `wallet_${txn._id}`,
    );

    txn.razorpayOrderId = razorpayOrder.id;
    await txn.save();

    return {
      walletTxnId: String(txn._id),
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,   // in paise
      currency: razorpayOrder.currency,
    };
  }

  // ── POST /wallet/add-money/verify ──────────────────────────────────────────

  /**
   * Client-side confirmation path — validates the Razorpay signature, then
   * hands off to the same applyTopUpCaptured() the webhook fallback and
   * wallet reconciliation sweep use (mirrors payments.controller.ts's
   * verifyPayment / PaymentFinalizationService split). Calling this 1x, 2x,
   * or 100x for the same payment produces an identical end state.
   */
  async verifyAddMoney(userId: string, dto: VerifyAddMoneyDto) {
    const { walletTxnId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto;

    const txn = await this.txnModel.findById(walletTxnId);
    if (!txn || txn.userId !== userId) {
      throw new BadRequestException('Transaction not found');
    }
    if (txn.status === WalletTxnStatus.COMPLETED) {
      // Idempotent — return current balance without error.
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      return { success: true, balance: user?.walletBalance ?? 0 };
    }
    if (txn.razorpayOrderId !== razorpayOrderId) {
      throw new BadRequestException('Transaction/payment mismatch');
    }

    const isValid = this.paymentsService.verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );

    if (!isValid) {
      txn.status = WalletTxnStatus.FAILED;
      await txn.save();
      throw new BadRequestException('Invalid payment signature');
    }

    const result = await this.applyTopUpCaptured({
      razorpayOrderId,
      razorpayPaymentId,
      eventType: 'verify.client_callback',
      source: PaymentEventSource.VERIFY,
    });

    if (!result.txn) {
      throw new BadRequestException('Transaction not found');
    }

    const user = await this.userModel.findById(userId).select('walletBalance').lean();
    return { success: true, balance: user?.walletBalance ?? 0, alreadyProcessed: !result.applied };
  }

  /**
   * The single place that is allowed to transition a wallet top-up's status
   * to COMPLETED and credit the balance. Verify, the Razorpay webhook
   * fallback, and the wallet reconciliation sweep all call this — none of
   * them contain their own copy of the write. Mirrors
   * PaymentFinalizationService.applyPaymentCaptured() for orders; kept as a
   * separate method (rather than folding WalletTransaction into that
   * service) because a wallet top-up isn't an Order — same guarantees,
   * different collection.
   */
  async applyTopUpCaptured(input: ApplyTopUpCapturedInput): Promise<ApplyTopUpCapturedResult> {
    const startedAt = Date.now();
    const { razorpayOrderId, razorpayPaymentId, amountPaise, source, requestId, traceId, rawPayload, eventType } = input;

    const txn = await this.txnModel.findOne({ razorpayOrderId });
    if (!txn) {
      this.metrics.increment('wallet_topup_txn_not_found_total');
      await logPaymentEvent(
        this.paymentEventModel,
        { ...input, outcome: PaymentEventOutcome.ORDER_NOT_FOUND, processingDurationMs: Date.now() - startedAt },
        this.logger,
      );
      return { applied: false, txn: null, outcome: PaymentEventOutcome.ORDER_NOT_FOUND };
    }

    // A payment can be captured at Razorpay for a txn we already marked
    // FAILED (a prior verify call saw a signature mismatch). Real money
    // still moved — never auto-credit against a txn we already flagged bad;
    // route to a human instead of silently completing or silently dropping.
    if (txn.status === WalletTxnStatus.FAILED) {
      this.metrics.increment('wallet_topup_captured_after_failed_total');
      this.alerts.raise('wallet_topup_captured_after_failed', {
        walletTxnId: txn._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
        source,
      });
      await this.txnModel.updateOne(
        { _id: txn._id },
        { $set: { needsManualReview: true, needsManualReviewReason: 'Payment captured at Razorpay for a top-up already marked FAILED — needs refund or manual credit review' } },
      );
      await logPaymentEvent(
        this.paymentEventModel,
        { ...input, outcome: PaymentEventOutcome.REJECTED_ALREADY_FAILED, processingDurationMs: Date.now() - startedAt },
        this.logger,
      );
      return { applied: false, txn, outcome: PaymentEventOutcome.REJECTED_ALREADY_FAILED };
    }

    // Defense in depth, same reasoning as the order flow: when the caller has
    // an authoritative captured amount (webhook payload, or a reconciliation
    // fetch from Razorpay), cross-check it against what this txn was actually
    // opened for before ever crediting. Verify doesn't pass amountPaise — its
    // HMAC already proves Razorpay issued this exact payment id for this
    // exact order id.
    if (amountPaise != null) {
      const expectedPaise = Math.round(txn.amount * 100);
      if (amountPaise !== expectedPaise) {
        this.metrics.increment('wallet_topup_amount_mismatch_total');
        this.alerts.raise('wallet_topup_amount_mismatch', {
          walletTxnId: txn._id.toString(),
          razorpayOrderId,
          razorpayPaymentId,
          expectedPaise,
          amountPaise,
          source,
        });
        await this.txnModel.updateOne(
          { _id: txn._id },
          { $set: { needsManualReview: true, needsManualReviewReason: 'Captured amount did not match the top-up amount' } },
        );
        await logPaymentEvent(
          this.paymentEventModel,
          { ...input, outcome: PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH, processingDurationMs: Date.now() - startedAt },
          this.logger,
        );
        return { applied: false, txn, outcome: PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH };
      }
    }

    // The one atomic write: only succeeds if this txn hasn't already been
    // finalized. Concurrent webhook + verify + reconciliation + duplicate
    // retries can never both "win" — exactly one does.
    const claimed = await this.txnModel.findOneAndUpdate(
      { _id: txn._id, status: WalletTxnStatus.PENDING },
      {
        $set: {
          status: WalletTxnStatus.COMPLETED,
          razorpayPaymentId,
          category: WalletTxnCategory.TOPUP,
          createdBy: 'USER',
        },
      },
      { new: true },
    );

    const durationMs = Date.now() - startedAt;

    if (!claimed) {
      // Already finalized by another call. Distinguish "same payment,
      // redelivered event" from "a different payment captured against a
      // txn already completed" (double-charge) — the latter needs a human.
      const current = await this.txnModel.findById(txn._id);
      const isDistinctPayment =
        !!current?.razorpayPaymentId && current.razorpayPaymentId !== razorpayPaymentId;

      if (isDistinctPayment) {
        this.metrics.increment('wallet_topup_duplicate_capture_flagged_total');
        this.alerts.raise('wallet_topup_duplicate_capture', {
          walletTxnId: txn._id.toString(),
          razorpayOrderId,
          existingPaymentId: current!.razorpayPaymentId,
          newPaymentId: razorpayPaymentId,
          source,
        });
        await this.txnModel.updateOne(
          { _id: txn._id },
          { $set: { needsManualReview: true, needsManualReviewReason: 'A second Razorpay payment was captured for a top-up already completed — likely a duplicate charge, needs manual refund review' } },
        );
        await logPaymentEvent(
          this.paymentEventModel,
          { ...input, outcome: PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED, processingDurationMs: durationMs },
          this.logger,
        );
        return { applied: false, txn: current, outcome: PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED };
      }

      this.metrics.increment('wallet_topup_duplicate_noop_total');
      await logPaymentEvent(
        this.paymentEventModel,
        { ...input, outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL, processingDurationMs: durationMs },
        this.logger,
      );
      return { applied: false, txn: current ?? txn, outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL };
    }

    const updatedUser = await this.userModel.findByIdAndUpdate(
      claimed.userId,
      { $inc: { walletBalance: claimed.amount } },
      { new: true, select: 'walletBalance' },
    );

    // Record the ledger balances on the transaction (best-effort audit fields).
    const closing = updatedUser?.walletBalance ?? claimed.amount;
    await this.txnModel.updateOne(
      { _id: claimed._id },
      {
        $set: {
          openingBalance: Math.round((closing - claimed.amount) * 100) / 100,
          closingBalance: closing,
        },
      },
    );

    this.metrics.increment('wallet_topup_completed_total');
    await logPaymentEvent(
      this.paymentEventModel,
      { ...input, outcome: PaymentEventOutcome.APPLIED, processingDurationMs: durationMs },
      this.logger,
    );

    // Side effect fires exactly once — only on the call that actually won
    // the transition above, never on a no-op replay.
    this.notificationsService
      .notifyPaymentSuccess(claimed.userId, 'Wallet top-up')
      .catch((e) => this.logger.error(`notifyPaymentSuccess failed for wallet txn ${claimed._id}: ${e.message}`));

    return { applied: true, txn: claimed, outcome: PaymentEventOutcome.APPLIED };
  }

  // ── Reconciliation support (used by payments/reconciliation.service.ts) ────

  /** Wallet top-ups stuck PENDING past the grace period, oldest sweep window first — mirrors the Order query in ReconciliationService. */
  async findStalePendingTopUps(graceMs: number, lookbackMs: number, limit: number): Promise<WalletTransactionDocument[]> {
    const now = Date.now();
    return this.txnModel
      .find({
        status: WalletTxnStatus.PENDING,
        razorpayOrderId: { $exists: true, $ne: null },
        needsManualReview: { $ne: true },
        createdAt: { $gte: new Date(now - lookbackMs), $lte: new Date(now - graceMs) },
      })
      .limit(limit);
  }

  /** Dead-letters a wallet top-up that reconciliation could not resolve (no captured payment found at Razorpay after the lookback window) — same "stop re-checking forever" purpose as the Order equivalent. */
  async markTopUpNeedsManualReview(walletTxnId: string, reason: string): Promise<void> {
    await this.txnModel.updateOne(
      { _id: walletTxnId },
      { $set: { needsManualReview: true, needsManualReviewReason: reason } },
    );
  }

  // ── POST /wallet/pay-order/:orderId ────────────────────────────────────────

  async payOrderWithWallet(userId: string, orderId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order || order.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      // Idempotent — already paid, just return current balance.
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      return { success: true, alreadyPaid: true, newBalance: user?.walletBalance ?? 0 };
    }
    if (order.paymentStatus !== PaymentStatus.PENDING) {
      throw new BadRequestException('Order is not awaiting payment');
    }
    if (!order.billAmount) {
      throw new BadRequestException('Bill has not been confirmed by admin yet');
    }
    if (
      order.status !== OrderStatus.ITEMIZED &&
      order.status !== OrderStatus.PROCESSING &&
      order.status !== OrderStatus.READY_FOR_PICKUP &&
      order.status !== OrderStatus.OUT_FOR_DELIVERY
    ) {
      throw new BadRequestException('Payment is available once your order is itemized and the bill is confirmed');
    }

    // Atomically deduct the wallet balance ONLY if it still covers the bill.
    // The $gte filter closes the check-then-act race: two concurrent pay calls
    // cannot both pass a stale balance check.
    const billAmount = order.billAmount;
    const updatedUser = await this.userModel.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: billAmount } },
      { $inc: { walletBalance: -billAmount } },
      { new: true, select: 'walletBalance' },
    );
    if (!updatedUser) {
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      const balance = user?.walletBalance ?? 0;
      throw new BadRequestException(
        `Insufficient wallet balance. Available: ₹${balance.toFixed(2)}, Required: ₹${billAmount.toFixed(2)}.`,
      );
    }

    // Atomically claim the order's payment (PENDING → COMPLETED) and generate
    // the delivery OTP — mirrors payments.controller.ts's verifyPayment
    // (Razorpay) flow, so the dispatch gate (which checks deliveryOtp) passes.
    // If a concurrent request already paid this order, refund the deduction.
    const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
    const claimedOrder = await this.orderModel.findOneAndUpdate(
      { _id: orderId, paymentStatus: PaymentStatus.PENDING },
      {
        paymentStatus: PaymentStatus.COMPLETED,
        paymentMethod: 'wallet',
        deliveryOtp,
      },
    );
    if (!claimedOrder) {
      // Lost the race — order was paid by another request. Give the money back.
      const reverted = await this.userModel.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: billAmount } },
        { new: true, select: 'walletBalance' },
      );
      return {
        success: true,
        alreadyPaid: true,
        newBalance: reverted?.walletBalance ?? 0,
      };
    }

    // Create a COMPLETED debit transaction linked to this order.
    const closing = updatedUser.walletBalance ?? 0;
    await this.txnModel.create({
      userId,
      type: WalletTxnType.DEBIT,
      amount: billAmount,
      description: `Payment for order #${order.orderNumber ?? String(order._id).slice(-6).toUpperCase()}`,
      status: WalletTxnStatus.COMPLETED,
      referenceOrderId: String(order._id),
      referenceId: String(order._id),
      category: WalletTxnCategory.PAYMENT,
      openingBalance: Math.round((closing + billAmount) * 100) / 100,
      closingBalance: closing,
      createdBy: 'USER',
    });

    // Redeem the coupon (if one was applied at checkout) now that payment has
    // actually cleared — mirrors the Razorpay path in PaymentFinalizationService.
    if (claimedOrder.couponId && claimedOrder.couponDiscountAmount) {
      this.couponsService
        .finalizeRedemption({
          orderId: String(claimedOrder._id),
          userId,
          couponId: claimedOrder.couponId,
          couponCode: claimedOrder.couponCode ?? '',
          discountAmount: claimedOrder.couponDiscountAmount,
        })
        .catch((e) => this.logger.error(`Coupon finalizeRedemption failed for order ${claimedOrder._id}: ${e.message}`));
    }

    // Invoice generation (non-blocking) — mirrors the Razorpay path in
    // PaymentFinalizationService. Wallet payments complete the order
    // directly here rather than through that service (no Razorpay
    // order/payment id to key off), so this call was missing entirely —
    // wallet-paid orders never got an Invoice document, and "Download
    // Invoice" never appeared for them on the customer app or admin panel.
    this.invoicesService
      .generateForOrder(claimedOrder)
      .catch((e) => this.logger.error(`Invoice generation failed for order ${claimedOrder._id}: ${e.message}`));

    // Fire payment success push notification (non-blocking)
    this.notificationsService
      .notifyPaymentSuccess(userId, order.orderNumber ?? '')
      .catch(() => { /* swallow — notification errors must not fail payment */ });

    // Admin notification bar: payment received (non-blocking)
    this.notificationsService
      .notifyAdmin({
        title: 'Payment Received 💳',
        body: `Payment confirmed for Order #${order.orderNumber ?? ''} — ₹${order.billAmount ?? 0}.`,
        type: 'payment_success',
        orderId: order.orderNumber ?? '',
      })
      .catch(() => { /* swallow */ });

    return {
      success: true,
      newBalance: updatedUser?.walletBalance ?? 0,
    };
  }
}
