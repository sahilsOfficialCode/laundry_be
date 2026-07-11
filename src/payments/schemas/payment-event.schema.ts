import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PaymentEventDocument = PaymentEvent & Document;

/** Which code path produced this event — every payment write must be traceable back to one of these. */
export enum PaymentEventSource {
  VERIFY = 'verify',
  WEBHOOK = 'webhook',
  RECONCILIATION = 'reconciliation',
}

export enum PaymentEventOutcome {
  APPLIED = 'applied',
  NOOP_ALREADY_FINAL = 'noop_already_final',
  DUPLICATE_IGNORED = 'duplicate_ignored',
  DUPLICATE_PAYMENT_FLAGGED = 'duplicate_payment_flagged',
  REJECTED_SIGNATURE = 'rejected_signature',
  REJECTED_AMOUNT_MISMATCH = 'rejected_amount_mismatch',
  REJECTED_ORDER_CANCELLED = 'rejected_order_cancelled',
  ORDER_NOT_FOUND = 'order_not_found',
  LOGGED_NO_TRANSITION = 'logged_no_transition',
  MALFORMED_PAYLOAD = 'malformed_payload',
  ERROR = 'error',
}

/**
 * Append-only audit log of every payment confirmation attempt (verify call,
 * webhook delivery, or reconciliation repair) — regardless of whether it
 * actually changed anything. This is what makes a stuck-payment incident
 * reconstructable after the fact, and `razorpayEventId` is the dedup key
 * that makes repeated webhook deliveries safe to no-op.
 */
@Schema({ timestamps: true })
export class PaymentEvent {
  @Prop({ required: false, index: true })
  orderId?: string;

  @Prop({ required: true, enum: PaymentEventSource })
  source: PaymentEventSource;

  /** Razorpay's `x-razorpay-event-id` header — unique per webhook delivery, the true dedup key for webhooks. Absent for verify/reconciliation. */
  @Prop({ required: false })
  razorpayEventId?: string;

  @Prop({ required: false, index: true })
  razorpayOrderId?: string;

  @Prop({ required: false, index: true })
  razorpayPaymentId?: string;

  /** e.g. payment.captured, payment.failed, order.paid, verify.success */
  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true, enum: PaymentEventOutcome })
  outcome: PaymentEventOutcome;

  @Prop({ required: false })
  amountPaise?: number;

  @Prop({ required: false })
  requestId?: string;

  @Prop({ required: false })
  traceId?: string;

  @Prop({ required: false })
  processingDurationMs?: number;

  @Prop({ type: Object, required: false })
  rawPayload?: Record<string, any>;

  @Prop({ required: false })
  errorMessage?: string;
}

export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);

// The real dedup mechanism for webhook redelivery: sparse so verify/reconciliation
// events (which have no razorpayEventId) never collide with each other.
PaymentEventSchema.index(
  { razorpayEventId: 1 },
  { unique: true, sparse: true },
);
PaymentEventSchema.index({ orderId: 1, createdAt: -1 });
