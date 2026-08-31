import { Injectable, Logger, OnApplicationBootstrap, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Order, OrderDocument, PaymentStatus } from '../orders/schemas/order.schema';
import { PaymentsService } from './payments.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentEventSource } from './schemas/payment-event.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';
import { describeRazorpayError } from './razorpay-error.util';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionDocument } from '../wallet/schemas/wallet-transaction.schema';

const GRACE_PERIOD_MS = 2 * 60 * 1000; // don't touch orders that might still have a verify/webhook in flight
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MANUAL_REVIEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_ORDERS_PER_RUN = 200;
const CONSECUTIVE_FAILURE_BREAKER_THRESHOLD = 5;

// Wallet top-ups get a longer grace period than orders (10 vs 2 minutes) —
// there's no checkout-abandonment UX pressure to resolve them fast, so it's
// not worth cutting the window close to when a verify call would still
// plausibly land.
const WALLET_GRACE_PERIOD_MS = 10 * 60 * 1000;
const MAX_WALLET_TXNS_PER_RUN = 200;

/**
 * The safety net for when BOTH the client callback and the webhook are
 * lost — the exact failure mode behind the ₹500 stuck-payment incident.
 * Every 5 minutes (and once at startup, to catch up on anything that piled
 * up while the app was down): find orders still PENDING with a Razorpay
 * order attached, ask Razorpay directly what actually happened, and repair
 * through the same applyPaymentCaptured() path verify/webhook use. No
 * separate repair logic.
 *
 * Also sweeps wallet top-ups (WalletTransaction, via WalletService) the same
 * way — same run, same circuit breaker, same bootstrap catch-up — so a
 * top-up whose verify call AND webhook delivery were both lost gets the same
 * safety net an order gets, instead of staying stuck PENDING forever.
 */
@Injectable()
export class ReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationService.name);
  private running = false;

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private paymentsService: PaymentsService,
    private paymentFinalization: PaymentFinalizationService,
    private metrics: PaymentMetricsService,
    private alerts: PaymentAlertsService,
    private configService: ConfigService,
    @Inject(forwardRef(() => WalletService)) private walletService: WalletService,
  ) {}

  /**
   * Catch up on anything that piled up while the app was down (deploy,
   * crash-restart) instead of waiting for the next 5-minute cron tick.
   * Deliberately NOT awaited by Nest's bootstrap sequence — if Razorpay's
   * API were slow or down, blocking here would delay app.listen() and take
   * down every unrelated endpoint for a payments convenience. It runs
   * concurrently with the app becoming ready to serve traffic.
   */
  onApplicationBootstrap(): void {
    this.reconcilePendingPayments().catch((err) =>
      this.logger.error(`Startup reconciliation sweep failed: ${(err as Error).message}`),
    );
  }

  @Cron('*/5 * * * *')
  async reconcilePendingPayments(): Promise<void> {
    if (this.configService.get<string>('PAYMENT_RECONCILIATION_ENABLED') === 'false') {
      this.logger.warn('Reconciliation run skipped — disabled via PAYMENT_RECONCILIATION_ENABLED');
      return;
    }
    if (this.running) {
      this.logger.warn('Reconciliation run skipped — previous run still in progress');
      return;
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const now = Date.now();
      const candidates = await this.orderModel
        .find({
          paymentStatus: PaymentStatus.PENDING,
          razorpayOrderId: { $exists: true, $ne: null },
          // Once an order has been flagged for manual review, the automatic
          // sweep must stop re-fetching it forever — otherwise every flagged
          // order becomes a permanent, ever-growing tax on every future run
          // (wasted Razorpay API calls, no chance of a different outcome).
          // A human (or the future admin "reconcile now" action) takes over
          // from here; this is the dead-letter exit.
          needsManualReview: { $ne: true },
          createdAt: { $gte: new Date(now - LOOKBACK_MS), $lte: new Date(now - GRACE_PERIOD_MS) },
        })
        .limit(MAX_ORDERS_PER_RUN);

      const walletCandidates = await this.walletService.findStalePendingTopUps(
        WALLET_GRACE_PERIOD_MS,
        LOOKBACK_MS,
        MAX_WALLET_TXNS_PER_RUN,
      );

      this.logger.log(
        `Reconciliation run: ${candidates.length} pending order(s), ${walletCandidates.length} pending wallet top-up(s) to check`,
      );

      // One shared breaker across both sweeps: a tripped breaker almost
      // always means the Razorpay API itself is down, which affects orders
      // and wallet top-ups identically — no reason to let one domain keep
      // hammering a downed API just because the other tripped first.
      let consecutiveFailures = 0;
      for (let i = 0; i < candidates.length; i++) {
        const order = candidates[i];
        const lookupSucceeded = await this.reconcileOne(order);

        if (!lookupSucceeded) {
          consecutiveFailures++;
          if (consecutiveFailures >= CONSECUTIVE_FAILURE_BREAKER_THRESHOLD) {
            const remaining = candidates.length - (i + 1);
            this.logger.error(
              `Reconciliation run aborted after ${consecutiveFailures} consecutive Razorpay lookup failures — ` +
                `likely a Razorpay API outage rather than a per-order issue; ${remaining} order(s) left unchecked this run`,
            );
            this.alerts.raise('reconciliation_circuit_breaker_tripped', {
              consecutiveFailures,
              remainingUnchecked: remaining,
            });
            consecutiveFailures = -1; // sentinel: breaker already tripped, skip the wallet sweep below too
            break;
          }
        } else {
          consecutiveFailures = 0;
        }
      }

      if (consecutiveFailures !== -1) {
        for (let i = 0; i < walletCandidates.length; i++) {
          const txn = walletCandidates[i];
          const lookupSucceeded = await this.reconcileOneWalletTxn(txn);

          if (!lookupSucceeded) {
            consecutiveFailures++;
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_BREAKER_THRESHOLD) {
              const remaining = walletCandidates.length - (i + 1);
              this.logger.error(
                `Reconciliation run aborted after ${consecutiveFailures} consecutive Razorpay lookup failures — ` +
                  `likely a Razorpay API outage rather than a per-transaction issue; ${remaining} wallet top-up(s) left unchecked this run`,
              );
              this.alerts.raise('reconciliation_circuit_breaker_tripped', {
                consecutiveFailures,
                remainingUnchecked: remaining,
                domain: 'wallet',
              });
              break;
            }
          } else {
            consecutiveFailures = 0;
          }
        }
      }

      await this.reportPendingAgeBuckets();
    } catch (err) {
      this.logger.error(`Reconciliation run failed: ${(err as Error).message}`);
    } finally {
      this.metrics.setGauge('reconciliation_last_run_duration_ms', Date.now() - startedAt);
      this.running = false;
    }
  }

  /**
   * Returns whether the Razorpay lookup itself succeeded — used to drive the
   * circuit breaker above. "No captured payment found yet" is a normal
   * outcome of a successful lookup (true); only the fetchOrderPayments call
   * actually throwing (Razorpay API failure) counts as a breaker-worthy
   * failure. A local DB error while applying a found capture is also not a
   * Razorpay-outage signal, so it's isolated separately and still returns
   * true — that order simply gets picked up again on the next run.
   */
  private async reconcileOne(order: OrderDocument): Promise<boolean> {
    let payments: any;
    try {
      payments = await this.paymentsService.fetchOrderPayments(order.razorpayOrderId!);
    } catch (err) {
      this.logger.error(`Razorpay lookup failed for order ${order._id}: ${describeRazorpayError(err)}`);
      return false;
    }

    try {
      const captured = payments?.items?.find((p: any) => p.status === 'captured');

      if (!captured) {
        const ageMs = Date.now() - (order.createdAt ?? new Date()).getTime();
        if (ageMs > MANUAL_REVIEW_AFTER_MS && !order.needsManualReview) {
          await this.orderModel.updateOne(
            { _id: order._id },
            {
              $set: {
                needsManualReview: true,
                needsManualReviewReason: 'No captured payment found at Razorpay after 24h of reconciliation attempts',
              },
            },
          );
          this.metrics.increment('payments_flagged_needs_review_total');
          this.alerts.raise('payment_needs_manual_review', {
            orderId: order._id.toString(),
            razorpayOrderId: order.razorpayOrderId,
            ageMs,
          });
        }
        return true;
      }

      const result = await this.paymentFinalization.applyPaymentCaptured({
        razorpayOrderId: order.razorpayOrderId!,
        razorpayPaymentId: captured.id,
        amountPaise: typeof captured.amount === 'number' ? captured.amount : undefined,
        eventType: 'reconciliation.captured_found',
        source: PaymentEventSource.RECONCILIATION,
        requestId: randomUUID(),
      });

      if (result.applied) {
        this.metrics.increment('payment_reconciliation_repairs_total');
        this.alerts.raise('reconciliation_repair', {
          orderId: order._id.toString(),
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: captured.id,
        });
        this.logger.warn(
          `Reconciliation repaired order ${order._id} — payment was captured at Razorpay but never reached this database (razorpayPaymentId=${captured.id})`,
        );
      }
      return true;
    } catch (err) {
      // Isolate failures per-order so one bad write doesn't abort the whole
      // run for every other pending order. Not a Razorpay-outage signal.
      this.logger.error(`Reconciliation failed while applying repair for order ${order._id}: ${(err as Error).message}`);
      return true;
    }
  }

  /** Wallet-top-up counterpart of reconcileOne() above — same return-value contract (drives the shared circuit breaker). */
  private async reconcileOneWalletTxn(txn: WalletTransactionDocument): Promise<boolean> {
    let payments: any;
    try {
      payments = await this.paymentsService.fetchOrderPayments(txn.razorpayOrderId!);
    } catch (err) {
      this.logger.error(`Razorpay lookup failed for wallet txn ${txn._id}: ${describeRazorpayError(err)}`);
      return false;
    }

    try {
      const captured = payments?.items?.find((p: any) => p.status === 'captured');

      if (!captured) {
        const ageMs = Date.now() - (txn.createdAt ?? new Date()).getTime();
        if (ageMs > MANUAL_REVIEW_AFTER_MS && !txn.needsManualReview) {
          await this.walletService.markTopUpNeedsManualReview(
            String(txn._id),
            'No captured payment found at Razorpay after 24h of reconciliation attempts',
          );
          this.metrics.increment('wallet_topup_flagged_needs_review_total');
          this.alerts.raise('wallet_topup_needs_manual_review', {
            walletTxnId: txn._id.toString(),
            razorpayOrderId: txn.razorpayOrderId,
            ageMs,
          });
        }
        return true;
      }

      const result = await this.walletService.applyTopUpCaptured({
        razorpayOrderId: txn.razorpayOrderId!,
        razorpayPaymentId: captured.id,
        amountPaise: typeof captured.amount === 'number' ? captured.amount : undefined,
        eventType: 'reconciliation.captured_found',
        source: PaymentEventSource.RECONCILIATION,
        requestId: randomUUID(),
      });

      if (result.applied) {
        this.metrics.increment('wallet_topup_reconciliation_repairs_total');
        this.alerts.raise('wallet_topup_reconciliation_repair', {
          walletTxnId: txn._id.toString(),
          razorpayOrderId: txn.razorpayOrderId,
          razorpayPaymentId: captured.id,
        });
        this.logger.warn(
          `Reconciliation repaired wallet top-up ${txn._id} — payment was captured at Razorpay but never reached this database (razorpayPaymentId=${captured.id})`,
        );
      }
      return true;
    } catch (err) {
      this.logger.error(`Reconciliation failed while applying repair for wallet txn ${txn._id}: ${(err as Error).message}`);
      return true;
    }
  }

  private async reportPendingAgeBuckets(): Promise<void> {
    const now = Date.now();
    // Deliberately NOT excluding needsManualReview here — this is a
    // monitoring gauge of true pending-order age, not an action query; a
    // flagged order is still pending and should still count.
    const baseFilter = { paymentStatus: PaymentStatus.PENDING, razorpayOrderId: { $exists: true, $ne: null } };
    const [over5m, over30m, over24h] = await Promise.all([
      this.orderModel.countDocuments({ ...baseFilter, createdAt: { $lte: new Date(now - 5 * 60 * 1000) } }),
      this.orderModel.countDocuments({ ...baseFilter, createdAt: { $lte: new Date(now - 30 * 60 * 1000) } }),
      this.orderModel.countDocuments({ ...baseFilter, createdAt: { $lte: new Date(now - MANUAL_REVIEW_AFTER_MS) } }),
    ]);

    this.metrics.setGauge('payments_pending_over_5m', over5m);
    this.metrics.setGauge('payments_pending_over_30m', over30m);
    this.metrics.setGauge('payments_pending_over_24h', over24h);

    if (over30m > 0) this.alerts.raise('payments_pending_over_30m', { count: over30m });
    if (over24h > 0) this.alerts.raise('payments_pending_over_24h', { count: over24h });
  }
}
