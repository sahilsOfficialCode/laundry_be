import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  RawBodyRequest,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus, PaymentStatus } from '../orders/schemas/order.schema';
import { CheckoutContextDto } from '../orders/dto/checkout-context.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentFinalizationService } from './payment-finalization.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { PaymentEventSource } from './schemas/payment-event.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { describeRazorpayError } from './razorpay-error.util';
import type { RequestWithContext } from '../request-context.middleware';

/** How long a still-unpaid Razorpay order is considered a live, reusable attempt rather than stale. */
const REUSE_WINDOW_MS = 20 * 60 * 1000;

interface InitiateResponse {
  orderId: unknown;
  razorpayOrderId: string;
  amount: number;
  currency: string;
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
    private readonly paymentFinalization: PaymentFinalizationService,
    private readonly webhookService: RazorpayWebhookService,
    private readonly metrics: PaymentMetricsService,
    private readonly configService: ConfigService,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  /**
   * POST /payments/create-order  (legacy — kept for backward compat, not used in new flow)
   * Creates a new order from cart AND opens a Razorpay session in one step.
   */
  @Post('create-order')
  async createOrder(@Body() body: CheckoutContextDto, @GetUser() user: any) {
    const userId = user.sub;
    const order = await this.ordersService.initiateCheckout(userId, body);
    const razorpayOrder = await this.paymentsService.createOrder(
      order.totalAmount,
      order._id.toString(),
    );
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();
    return {
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    };
  }

  /**
   * POST /payments/initiate/:orderId
   * New endpoint — called after admin sets the bill (PROCESSING status).
   * Creates a Razorpay payment session for the confirmed bill amount.
   * Order must be in PROCESSING status and payment must be PENDING.
   *
   * Hardened against repeated "Pay Now" taps: a stuck-payment incident
   * traced back to exactly this endpoint minting a brand-new Razorpay order
   * on a retry, silently orphaning an earlier order that had actually
   * already been captured (the client's verify call for that first payment
   * never landed). Before minting anything new, this now checks the
   * existing razorpayOrderId's real state at Razorpay: if it was captured,
   * finalize it through the same shared path everything else uses; if it's
   * still live and unpaid, reuse it as-is; only mint a fresh order when the
   * previous attempt is genuinely stale or its amount no longer matches.
   * Contract is unchanged — same request, same response shape, same error
   * messages for the cases that already existed.
   */
  @Post('initiate/:orderId')
  async initiatePaymentForOrder(
    @Param('orderId') orderId: string,
    @GetUser() user: any,
    @Req() req: RequestWithContext,
  ) {
    const order = await this.orderModel.findById(orderId);
    if (!order || String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }
    if (
      order.status !== OrderStatus.ITEMIZED &&
      order.status !== OrderStatus.PROCESSING &&
      order.status !== OrderStatus.READY_FOR_PICKUP &&
      order.status !== OrderStatus.OUT_FOR_DELIVERY
    ) {
      throw new BadRequestException('Payment can be made once your order is itemized and the bill is confirmed.');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Payment has already been completed for this order.');
    }
    if (!order.billAmount || order.billAmount <= 0) {
      throw new BadRequestException('Bill amount has not been set by admin yet.');
    }

    if (order.razorpayOrderId) {
      const resolution = await this.resolveExistingRazorpayOrder(order, req.requestId);
      if (resolution) return resolution;
      // null => genuinely stale/mismatched or undeterminable right now — fall through to mint a fresh one.
    }

    return this.mintNewRazorpayOrder(order);
  }

  /**
   * Checks the order's existing razorpayOrderId against Razorpay directly.
   * Returns a response to hand back as-is (reuse), throws if the order
   * turns out to already be settled/flagged, or returns null to signal
   * "mint a fresh one" (stale, amount changed, or the check itself failed).
   */
  private async resolveExistingRazorpayOrder(
    order: OrderDocument,
    requestId: string,
  ): Promise<InitiateResponse | null> {
    const razorpayOrderId = order.razorpayOrderId!;

    let razorpayOrder: any;
    let payments: any;
    try {
      [razorpayOrder, payments] = await Promise.all([
        this.paymentsService.fetchOrder(razorpayOrderId),
        this.paymentsService.fetchOrderPayments(razorpayOrderId),
      ]);
    } catch (err) {
      // Fail open on the optimization, not on the customer's ability to pay
      // — the webhook and reconciliation are still there as the real safety
      // net if this specific check can't run right now.
      this.logger.error(`Could not check existing Razorpay order ${razorpayOrderId} before re-initiating: ${describeRazorpayError(err)}`);
      return null;
    }

    const captured = payments?.items?.find((p: any) => p.status === 'captured');
    if (captured) {
      const result = await this.paymentFinalization.applyPaymentCaptured({
        razorpayOrderId,
        razorpayPaymentId: captured.id,
        amountPaise: typeof captured.amount === 'number' ? captured.amount : undefined,
        eventType: 'initiate.reuse_check_found_captured',
        source: PaymentEventSource.RECONCILIATION,
        requestId,
      });

      if (result.order?.paymentStatus === PaymentStatus.COMPLETED) {
        throw new BadRequestException('Payment has already been completed for this order.');
      }
      // Captured but applyPaymentCaptured didn't complete it (e.g. flagged
      // for manual review over an amount mismatch, or the order was
      // cancelled) — do not paper over that by minting a new order on top.
      throw new BadRequestException('This order has a payment issue that needs review — please contact support.');
    }

    const expectedPaise = Math.round(order.billAmount! * 100);
    const amountMatches = razorpayOrder.amount === expectedPaise;
    const stillLive = razorpayOrder.status !== 'paid';
    const ageMs = Date.now() - razorpayOrder.created_at * 1000;

    if (amountMatches && stillLive && ageMs < REUSE_WINDOW_MS) {
      return {
        orderId: order._id,
        razorpayOrderId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      };
    }

    return null;
  }

  /**
   * Mints a fresh Razorpay order and race-safely persists it: the write is
   * conditional on razorpayOrderId still being whatever we last observed,
   * so two concurrent "Pay Now" taps can't both overwrite each other. The
   * loser defers to whatever the winner set rather than returning its own
   * now-orphaned mint (that stray Razorpay order is harmless — just unused
   * — since nothing in our DB will ever reference it).
   */
  private async mintNewRazorpayOrder(order: OrderDocument): Promise<InitiateResponse> {
    const observedRazorpayOrderId = order.razorpayOrderId;
    const razorpayOrder = await this.paymentsService.createOrder(order.billAmount!, order._id.toString());

    const filter: Record<string, any> = { _id: order._id };
    filter.razorpayOrderId = observedRazorpayOrderId ? observedRazorpayOrderId : { $exists: false };

    const updated = await this.orderModel.findOneAndUpdate(
      filter,
      { $set: { razorpayOrderId: razorpayOrder.id } },
      { new: true },
    );

    if (updated) {
      return {
        orderId: updated._id,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      };
    }

    // Lost the race — a concurrent request already changed razorpayOrderId
    // since we read it. Defer to what it resolved to instead of returning
    // our own orphaned mint.
    const latest = await this.orderModel.findById(order._id);
    if (!latest) {
      throw new BadRequestException('Order not found');
    }
    if (latest.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Payment has already been completed for this order.');
    }
    return {
      orderId: latest._id,
      razorpayOrderId: latest.razorpayOrderId!,
      amount: Math.round((latest.billAmount ?? order.billAmount!) * 100),
      currency: 'INR',
    };
  }

  /**
   * POST /payments/verify
   * Client-side confirmation path — validates the Razorpay signature, then
   * hands off to the same PaymentFinalizationService the webhook and
   * reconciliation job use. Calling this 1x, 2x, or 100x for the same
   * payment produces an identical end state: only the first call to
   * actually win the transition sends notifications or mints an OTP: later
   * calls (from a client retry, a second tab, or a webhook that got there
   * first) see the order already COMPLETED and no-op.
   */
  @Post('verify')
  async verifyPayment(
    @Body() body: { orderId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
    @GetUser() user: any,
    @Req() req: RequestWithContext,
  ) {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new BadRequestException('Missing payment verification fields');
    }

    const isValid = this.paymentsService.verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );

    if (!isValid) {
      this.metrics.increment('verify_signature_failures_total');
      throw new BadRequestException('Invalid payment signature');
    }

    const order = await this.orderModel.findById(orderId);
    if (!order || String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }
    if (order.razorpayOrderId !== razorpayOrderId) {
      throw new BadRequestException('Order/payment mismatch');
    }

    const result = await this.paymentFinalization.applyPaymentCaptured({
      razorpayOrderId,
      razorpayPaymentId,
      eventType: 'verify.client_callback',
      source: PaymentEventSource.VERIFY,
      requestId: req.requestId,
    });

    if (!result.order) {
      throw new BadRequestException('Order not found');
    }

    return { success: true, order: result.order, alreadyProcessed: !result.applied };
  }

  @Post('failed')
  async markPaymentFailed(@Body('orderId') orderId: string, @GetUser() user: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order || String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }

    // Never overwrite a payment that has already completed (e.g. a webhook
    // or a second browser tab confirmed it moments after this client gave
    // up waiting) — the client's own view of "it failed" can be stale.
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      return { success: true, order };
    }

    order.paymentStatus = PaymentStatus.FAILED;
    await order.save();

    return { success: true, order };
  }

  /**
   * POST /payments/webhook/razorpay
   * Server-to-server delivery from Razorpay — this is the authoritative
   * confirmation channel that doesn't depend on any customer's browser tab
   * surviving. Public (no JWT — Razorpay can't present a user token) but
   * every byte is signature-checked before anything is trusted.
   */
  @Public()
  @Post('webhook/razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: RawBodyRequest<Request> & RequestWithContext,
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') eventId: string,
  ) {
    // Incident-response kill switch — flip PAYMENT_WEBHOOK_ENABLED=false to
    // stop processing instantly without depending on Razorpay dashboard
    // access/propagation delay. Still ack 200 so Razorpay doesn't retry-storm.
    if (this.configService.get<string>('PAYMENT_WEBHOOK_ENABLED') === 'false') {
      this.metrics.increment('webhook_disabled_by_flag_total');
      return { received: true, outcome: 'disabled' };
    }
    return this.webhookService.handleDelivery({
      rawBody: req.rawBody,
      signature,
      eventId,
      body: req.body,
      requestId: req.requestId,
    });
  }

  /** Internal — snapshot of in-process payment counters/gauges. JWT-protected; not yet role-gated (tracked as Phase 2 work alongside the rest of the admin-role hardening). */
  @Get('metrics')
  getMetrics() {
    return this.metrics.snapshot();
  }
}
