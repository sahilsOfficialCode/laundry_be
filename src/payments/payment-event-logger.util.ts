import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { PaymentEventDocument, PaymentEventOutcome, PaymentEventSource } from './schemas/payment-event.schema';

export interface PaymentEventLogParams {
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
}

/**
 * Shared with WalletService's applyTopUpCaptured() so wallet top-ups land in
 * the same append-only audit trail (PaymentEvent) as order payments, keyed
 * the same way — a support engineer investigating a razorpayOrderId doesn't
 * need to know in advance whether it was an order or a wallet top-up.
 * Behavior copied verbatim from PaymentFinalizationService's original
 * private logEvent (dedup-on-11000, one retry, never throws).
 */
export async function logPaymentEvent(
  model: Model<PaymentEventDocument>,
  params: PaymentEventLogParams,
  logger: Logger,
): Promise<void> {
  try {
    await model.create(params);
  } catch (err) {
    if ((err as any)?.code === 11000) {
      logger.debug(`PaymentEvent already logged for this event (expected dedup hit): ${params.razorpayEventId}`);
    } else {
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await model.create(params);
      } catch (retryErr) {
        logger.error(
          `PaymentEvent log write failed after retry — audit trail gap for order ${params.orderId}: ${(retryErr as Error).message}`,
        );
      }
    }
  }
  logger.log(
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
