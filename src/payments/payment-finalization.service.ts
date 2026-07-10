import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus, PaymentStatus } from '../orders/schemas/order.schema';
import {
  PaymentEvent,
  PaymentEventDocument,
  PaymentEventOutcome,
  PaymentEventSource,
} from './schemas/payment-event.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';

export interface ApplyPaymentCapturedInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  /** Captured amount in paise, when the caller has it (webhook/reconciliation). Verify doesn't supply one — the order's own Razorpay order was already minted server-side with the right amount, so signature validity is sufficient there. */
  amountPaise?: number;
  eventType: string;
  source: PaymentEventSource;
  razorpayEventId?: string;
  requestId?: string;
  traceId?: string;
  rawPayload?: Record<string, any>;
}

export interface ApplyPaymentCapturedResult {
  applied: boolean;
  order: OrderDocument | null;
  outcome: PaymentEventOutcome;
}

function generateDeliveryOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * The single place that is allowed to transition an order's paymentStatus to
 * COMPLETED. Verify, the Razorpay webhook, and the reconciliation job all
 * call this — none of them contain their own copy of this logic. That's
 * what makes "webhook first / verify first / both / twenty retries" all
 * produce the same end state: whichever call arrives first performs the
 * one atomic write; every later call (any source, any number of times)
 * sees the order already COMPLETED and no-ops.
 */
@Injectable()
export class PaymentFinalizationService {
  private readonly logger = new Logger(PaymentFinalizationService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(PaymentEvent.name) private paymentEventModel: Model<PaymentEventDocument>,
    private notificationsService: NotificationsService,
    private metrics: PaymentMetricsService,
    private alerts: PaymentAlertsService,
  ) {}

  async applyPaymentCaptured(input: ApplyPaymentCapturedInput): Promise<ApplyPaymentCapturedResult> {
    const startedAt = Date.now();
    const { razorpayOrderId, razorpayPaymentId, amountPaise, source, requestId, traceId, rawPayload, eventType } = input;

    const order = await this.orderModel.findOne({ razorpayOrderId });
    if (!order) {
      this.metrics.increment('payments_order_not_found_total');
      this.logEvent({
        ...input,
        outcome: PaymentEventOutcome.ORDER_NOT_FOUND,
        processingDurationMs: Date.now() - startedAt,
      }).catch(() => {});
      return { applied: false, order: null, outcome: PaymentEventOutcome.ORDER_NOT_FOUND };
    }

    // A payment can legitimately be captured at Razorpay after an order was
    // cancelled on our side (the customer cancelled while a checkout was
    // still open, or an admin cancelled moments before capture). We must
    // never silently complete a cancelled order — but we also must never
    // silently drop the fact that real money moved. Flag it for a human.
    if (order.status === OrderStatus.CANCELLED) {
      this.metrics.increment('payments_captured_after_cancellation_total');
      this.alerts.raise('payment_captured_after_cancellation', {
        orderId: order._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
        source,
      });
      await this.orderModel.updateOne(
        { _id: order._id },
        { $set: { needsManualReview: true, needsManualReviewReason: 'Payment captured for an order that was already cancelled — needs refund review' } },
      );
      this.logEvent({
        ...input,
        orderId: order._id.toString(),
        outcome: PaymentEventOutcome.REJECTED_ORDER_CANCELLED,
        processingDurationMs: Date.now() - startedAt,
      }).catch(() => {});
      return { applied: false, order, outcome: PaymentEventOutcome.REJECTED_ORDER_CANCELLED };
    }

    // Defense in depth: when the caller has an authoritative captured amount
    // (webhook payload, or a reconciliation fetch from Razorpay), cross-check
    // it against what this order was actually billed for before ever marking
    // it paid. Verify doesn't pass amountPaise — its HMAC already proves
    // Razorpay issued this exact payment id for this exact order id.
    if (amountPaise != null) {
      const expectedPaise = Math.round((order.billAmount ?? order.totalAmount) * 100);
      if (amountPaise !== expectedPaise) {
        this.metrics.increment('payments_amount_mismatch_total');
        this.alerts.raise('payment_amount_mismatch', {
          orderId: order._id.toString(),
          razorpayOrderId,
          razorpayPaymentId,
          expectedPaise,
          amountPaise,
          source,
        });
        await this.orderModel.updateOne(
          { _id: order._id },
          { $set: { needsManualReview: true, needsManualReviewReason: 'Captured amount did not match the billed amount' } },
        );
        this.logEvent({
          ...input,
          orderId: order._id.toString(),
          outcome: PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH,
          processingDurationMs: Date.now() - startedAt,
        }).catch(() => {});
        return { applied: false, order, outcome: PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH };
      }
    }

    const otp = generateDeliveryOtp();

    // The one atomic write: only succeeds if this order hasn't already been
    // finalized. MongoDB guarantees this findOneAndUpdate is applied
    // atomically per-document, so concurrent webhook + verify + reconciliation
    // + duplicate-retry calls can never both "win" — exactly one does.
    const updated = await this.orderModel.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: PaymentStatus.COMPLETED } },
      {
        $set: {
          paymentStatus: PaymentStatus.COMPLETED,
          razorpayPaymentId,
          deliveryOtp: otp,
        },
      },
      { new: true },
    );

    const durationMs = Date.now() - startedAt;

    if (updated) {
      this.metrics.increment('payments_completed_total');
      this.logEvent({
        ...input,
        orderId: order._id.toString(),
        outcome: PaymentEventOutcome.APPLIED,
        processingDurationMs: durationMs,
      }).catch(() => {});

      // Side effects fire exactly once — only on the call that actually won
      // the transition above, never on a no-op replay.
      this.notificationsService
        .notifyPaymentSuccess(updated.userId, updated.orderNumber ?? '')
        .catch((e) => this.logger.error(`notifyPaymentSuccess failed for order ${updated._id}: ${e.message}`));
      this.notificationsService
        .notifyAdmin({
          title: 'Payment Received 💳',
          body: `Payment confirmed for Order #${updated.orderNumber ?? ''} — ₹${updated.totalAmount ?? 0}.`,
          type: 'payment_success',
          orderId: updated.orderNumber ?? '',
        })
        .catch((e) => this.logger.error(`notifyAdmin failed for order ${updated._id}: ${e.message}`));

      return { applied: true, order: updated, outcome: PaymentEventOutcome.APPLIED };
    }

    // Already finalized by another call. Distinguish "same payment, redelivered
    // event" (Razorpay sends both payment.captured and order.paid for one
    // transaction, and any of verify/webhook/reconciliation can also race
    // each other) from "a *different* payment captured against an
    // already-paid order" (double-charge — e.g. customer double-clicked Pay
    // or retried after a UI hang) — the latter needs a human, not a silent drop.
    const current = await this.orderModel.findById(order._id);
    const isDistinctPayment =
      !!current?.razorpayPaymentId && current.razorpayPaymentId !== razorpayPaymentId;

    if (isDistinctPayment) {
      this.metrics.increment('payments_duplicate_capture_flagged_total');
      this.alerts.raise('duplicate_capture_same_order', {
        orderId: order._id.toString(),
        razorpayOrderId,
        existingPaymentId: current!.razorpayPaymentId,
        newPaymentId: razorpayPaymentId,
        source,
      });
      await this.orderModel.updateOne(
        { _id: order._id },
        { $set: { needsManualReview: true, needsManualReviewReason: 'A second Razorpay payment was captured for an order already marked paid — likely a duplicate charge, needs manual refund review' } },
      );
      this.logEvent({
        ...input,
        orderId: order._id.toString(),
        outcome: PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED,
        processingDurationMs: durationMs,
      }).catch(() => {});
      return { applied: false, order: current, outcome: PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED };
    }

    this.metrics.increment('payments_duplicate_noop_total');
    this.logEvent({
      ...input,
      orderId: order._id.toString(),
      outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL,
      processingDurationMs: durationMs,
    }).catch(() => {});
    return { applied: false, order: current ?? order, outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL };
  }

  /**
   * Fire-and-forget by design — every call site above does NOT await this.
   * The audit trail must never add latency to (or be able to fail) the
   * money-critical Order write above it, and the webhook path in particular
   * is required to ack Razorpay quickly. A duplicate razorpayEventId hitting
   * the unique index is an *expected* outcome (webhook redelivery), not a
   * failure; any other error gets one short retry, and if that still fails
   * it's surfaced as a metric + error log rather than silently dropped —
   * it's a gap in the audit trail, not in payment correctness.
   */
  private async logEvent(params: {
    orderId?: string;
    source: PaymentEventSource;
    razorpayEventId?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    eventType: string;
    outcome: PaymentEventOutcome;
    amountPaise?: number;
    requestId?: string;
    traceId?: string;
    processingDurationMs?: number;
    rawPayload?: Record<string, any>;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.paymentEventModel.create(params);
    } catch (err) {
      if ((err as any)?.code === 11000) {
        this.logger.debug(`PaymentEvent already logged for this event (expected dedup hit): ${params.razorpayEventId}`);
      } else {
        try {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await this.paymentEventModel.create(params);
        } catch (retryErr) {
          this.metrics.increment('payment_event_log_failures_total');
          this.logger.error(
            `PaymentEvent log write failed after retry — audit trail gap for order ${params.orderId}: ${(retryErr as Error).message}`,
          );
        }
      }
    }
    this.logger.log(
      JSON.stringify({
        orderId: params.orderId,
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: params.razorpayPaymentId,
        source: params.source,
        eventType: params.eventType,
        outcome: params.outcome,
        requestId: params.requestId,
        traceId: params.traceId,
        processingDurationMs: params.processingDurationMs,
      }),
    );
  }
}
