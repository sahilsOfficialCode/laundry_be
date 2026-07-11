import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentEventSource, PaymentEventOutcome } from './schemas/payment-event.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentEvent, PaymentEventDocument } from './schemas/payment-event.schema';

export interface WebhookDeliveryInput {
  rawBody: Buffer | undefined;
  signature: string | undefined;
  eventId: string | undefined;
  body: any;
  requestId?: string;
}

const HANDLED_CAPTURE_EVENTS = new Set(['payment.captured', 'order.paid']);

/**
 * Thin adapter between "an HTTP delivery from Razorpay" and the shared
 * PaymentFinalizationService — this file owns webhook-specific concerns
 * (signature verification, event-id dedup, event-type routing) and contains
 * zero business logic of its own. Every state transition still goes through
 * applyPaymentCaptured().
 */
@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private paymentsService: PaymentsService,
    private paymentFinalization: PaymentFinalizationService,
    private metrics: PaymentMetricsService,
    private alerts: PaymentAlertsService,
    @InjectModel(PaymentEvent.name) private paymentEventModel: Model<PaymentEventDocument>,
  ) {}

  async handleDelivery(input: WebhookDeliveryInput): Promise<{ received: boolean; outcome: string }> {
    const { rawBody, signature, eventId, body, requestId } = input;

    this.metrics.increment('webhook_deliveries_total');

    const isValid = this.paymentsService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.metrics.increment('webhook_signature_failures_total');
      this.alerts.raise('webhook_signature_invalid', { eventId, requestId, event: body?.event });
      this.logger.warn(`Rejected webhook delivery — invalid signature (event=${body?.event}, eventId=${eventId})`);
      // Still ack 200: a signature failure is never something Razorpay should
      // retry into a retry storm, and we must never leak *why* over the wire.
      return { received: true, outcome: 'rejected_signature' };
    }

    // Fast-path dedup: Razorpay retries undelivered/timed-out webhooks for up
    // to ~24h and can also send the same logical event more than once. If
    // we've already logged this exact delivery, don't reprocess it.
    if (eventId) {
      const alreadySeen = await this.paymentEventModel.findOne({ razorpayEventId: eventId }).lean();
      if (alreadySeen) {
        this.metrics.increment('webhook_duplicate_events_total');
        this.logger.log(`Duplicate webhook delivery ignored (eventId=${eventId}, event=${body?.event})`);
        return { received: true, outcome: 'duplicate_ignored' };
      }
    }

    const eventType: string = body?.event ?? 'unknown';
    const paymentEntity = body?.payload?.payment?.entity;

    if (!HANDLED_CAPTURE_EVENTS.has(eventType)) {
      // payment.failed and anything else: logged for audit/observability only.
      // Deliberately NOT flipping paymentStatus to FAILED here — Razorpay
      // reuses the same order_id across retried checkout attempts, so a
      // failed attempt does not mean the order can never be paid. Getting
      // this wrong would trade one money-loss bug for a different one.
      await this.logOnly({ eventId, eventType, body, requestId });
      return { received: true, outcome: 'logged_no_transition' };
    }

    if (!paymentEntity?.id || !paymentEntity?.order_id) {
      this.logger.error(`Webhook event ${eventType} missing payment entity — eventId=${eventId}`);
      await this.logOnly({ eventId, eventType, body, requestId, error: 'missing_payment_entity' });
      return { received: true, outcome: 'malformed_payload' };
    }

    const result = await this.paymentFinalization.applyPaymentCaptured({
      razorpayOrderId: paymentEntity.order_id,
      razorpayPaymentId: paymentEntity.id,
      amountPaise: typeof paymentEntity.amount === 'number' ? paymentEntity.amount : undefined,
      eventType,
      source: PaymentEventSource.WEBHOOK,
      razorpayEventId: eventId,
      requestId,
      rawPayload: body,
    });

    return { received: true, outcome: result.outcome };
  }

  private async logOnly(params: { eventId?: string; eventType: string; body: any; requestId?: string; error?: string }) {
    try {
      await this.paymentEventModel.create({
        source: PaymentEventSource.WEBHOOK,
        razorpayEventId: params.eventId,
        eventType: params.eventType,
        outcome: params.error ? PaymentEventOutcome.MALFORMED_PAYLOAD : PaymentEventOutcome.LOGGED_NO_TRANSITION,
        requestId: params.requestId,
        rawPayload: params.body,
        errorMessage: params.error,
      });
    } catch (err) {
      this.logger.warn(`Failed to log webhook event ${params.eventType}: ${(err as Error).message}`);
    }
  }
}
