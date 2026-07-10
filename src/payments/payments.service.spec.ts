import * as crypto from 'crypto';
import { PaymentsService } from './payments.service';

function fakeConfigService(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as any;
}

describe('PaymentsService — signature verification', () => {
  it('verifyPayment accepts a correctly-signed order_id|payment_id pair', () => {
    const service = new PaymentsService(fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 'secret' }));
    const signature = crypto.createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(service.verifyPayment('order_1', 'pay_1', signature)).toBe(true);
  });

  it('verifyPayment rejects a tampered payment id even with an otherwise-valid-looking signature', () => {
    const service = new PaymentsService(fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 'secret' }));
    const signature = crypto.createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(service.verifyPayment('order_1', 'pay_ATTACKER_SUBSTITUTED', signature)).toBe(false);
  });

  it('verifyWebhookSignature accepts a signature computed over the exact raw body with the webhook secret', () => {
    const service = new PaymentsService(
      fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'whsec' }),
    );
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const signature = crypto.createHmac('sha256', 'whsec').update(rawBody).digest('hex');
    expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it('verifyWebhookSignature rejects a payload re-serialized after signing (byte-for-byte raw body required)', () => {
    const service = new PaymentsService(
      fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'whsec' }),
    );
    const original = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: {} }));
    const signature = crypto.createHmac('sha256', 'whsec').update(original).digest('hex');
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(original.toString()))); // same logical content, re-encoded
    // In this case the two happen to match byte-for-byte, so mutate whitespace to prove the point:
    const tampered = Buffer.from(original.toString() + ' ');
    expect(service.verifyWebhookSignature(tampered, signature)).toBe(false);
    expect(service.verifyWebhookSignature(reserialized, signature)).toBe(true);
  });

  it('verifyWebhookSignature rejects a missing/undefined signature or body rather than throwing', () => {
    const service = new PaymentsService(
      fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'whsec' }),
    );
    expect(service.verifyWebhookSignature(undefined, 'abc')).toBe(false);
    expect(service.verifyWebhookSignature(Buffer.from('x'), undefined)).toBe(false);
  });

  it('verifyWebhookSignature throws a clear config error rather than silently accepting when the webhook secret is unset', () => {
    const service = new PaymentsService(fakeConfigService({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' }));
    expect(() => service.verifyWebhookSignature(Buffer.from('x'), 'sig')).toThrow();
  });
});
