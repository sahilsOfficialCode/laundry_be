import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { describeRazorpayError } from './razorpay-error.util';

const WEBHOOK_SECRET_PLACEHOLDERS = new Set([
  'change-me',
  'REPLACE_WITH_RAZORPAY_DASHBOARD_WEBHOOK_SECRET',
]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpay: any;

  constructor(private configService: ConfigService) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing in .env');
    }

    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    // Fail loud at boot rather than silent-until-the-first-real-delivery:
    // a misconfigured webhook secret otherwise only surfaces the moment a
    // real Razorpay webhook arrives (which fails closed, safely, but
    // invisibly). This is a warning, not a crash — the webhook is inert
    // until its URL is registered in the Razorpay dashboard, so it
    // shouldn't take down the rest of the app over a not-yet-configured
    // optional endpoint.
    const webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret || WEBHOOK_SECRET_PLACEHOLDERS.has(webhookSecret)) {
      this.logger.warn(
        'RAZORPAY_WEBHOOK_SECRET is not configured — POST /payments/webhook/razorpay will reject every delivery until this is set to the real value from the Razorpay Dashboard.',
      );
    }
  }

  async createOrder(amount: number, receiptId: string) {
    const options = {
      amount: Math.round(amount * 100), // amount in the smallest currency unit (paise)
      currency: 'INR',
      receipt: receiptId,
    };

    try {
      const order = await this.razorpay.orders.create(options);
      return order;
    } catch (error) {
      // Previously swallowed entirely — a bad key/secret (e.g. a 401) gave
      // the customer a generic 500 with zero trace of why in the logs.
      this.logger.error(`Razorpay order creation failed: ${describeRazorpayError(error)}`);
      throw new InternalServerErrorException('Failed to create Razorpay order');
    }
  }

  verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
  ): boolean {
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    if (!keySecret) {
      throw new InternalServerErrorException('Razorpay secret key not configured');
    }

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    return generatedSignature === signature;
  }

  /**
   * Verifies a Razorpay webhook delivery. Per Razorpay's docs, the signature
   * is HMAC-SHA256 of the *raw* request body (never the re-serialized/parsed
   * JSON) using the webhook secret configured in the dashboard — a different
   * secret and a different signed payload than the client-side verify() above.
   */
  verifyWebhookSignature(rawBody: Buffer | string | undefined, signature: string | undefined): boolean {
    const webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new InternalServerErrorException('Razorpay webhook secret not configured');
    }
    if (!signature || !rawBody) return false;

    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  /** Used by reconciliation to independently ask Razorpay what actually happened to an order, instead of trusting any client input. */
  async fetchOrderPayments(razorpayOrderId: string): Promise<any> {
    return this.razorpay.orders.fetchPayments(razorpayOrderId);
  }

  /** Used by /payments/initiate to check a prior Razorpay order's own status/amount/age before deciding whether to reuse it or mint a new one. */
  async fetchOrder(razorpayOrderId: string): Promise<any> {
    return this.razorpay.orders.fetch(razorpayOrderId);
  }
}
