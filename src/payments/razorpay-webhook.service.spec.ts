import { RazorpayWebhookService } from './razorpay-webhook.service';
import { PaymentEventOutcome } from './schemas/payment-event.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';

describe('RazorpayWebhookService', () => {
  let paymentsService: { verifyWebhookSignature: jest.Mock; fetchOrderPayments: jest.Mock };
  let paymentFinalization: { applyPaymentCaptured: jest.Mock };
  let paymentEventModel: { findOne: jest.Mock; create: jest.Mock };
  let metrics: PaymentMetricsService;
  let alerts: PaymentAlertsService;
  let service: RazorpayWebhookService;

  beforeEach(() => {
    paymentsService = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      fetchOrderPayments: jest.fn(),
    };
    paymentFinalization = {
      applyPaymentCaptured: jest.fn().mockResolvedValue({ applied: true, outcome: PaymentEventOutcome.APPLIED, order: {} }),
    };
    paymentEventModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
      create: jest.fn().mockResolvedValue({}),
    };
    metrics = new PaymentMetricsService();
    alerts = new PaymentAlertsService();
    service = new RazorpayWebhookService(
      paymentsService as any,
      paymentFinalization as any,
      metrics,
      alerts,
      paymentEventModel as any,
    );
  });

  const capturedPayload = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_abc', order_id: 'order_test123', amount: 50000 } } },
  };

  it('rejects a delivery with an invalid signature without processing it', async () => {
    paymentsService.verifyWebhookSignature.mockReturnValue(false);
    const result = await service.handleDelivery({
      rawBody: Buffer.from(JSON.stringify(capturedPayload)),
      signature: 'bad-signature',
      eventId: 'evt_1',
      body: capturedPayload,
    });

    expect(result.outcome).toBe('rejected_signature');
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
    expect(metrics.snapshot().counters['webhook_signature_failures_total']).toBe(1);
  });

  it('routes payment.captured to applyPaymentCaptured with the right fields', async () => {
    await service.handleDelivery({
      rawBody: Buffer.from('irrelevant-for-this-test'),
      signature: 'good-signature',
      eventId: 'evt_2',
      body: capturedPayload,
    });

    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayOrderId: 'order_test123',
        razorpayPaymentId: 'pay_abc',
        amountPaise: 50000,
        eventType: 'payment.captured',
      }),
    );
  });

  it('ignores a duplicate delivery of the same event id without reprocessing it', async () => {
    paymentEventModel.findOne.mockReturnValue({ lean: () => Promise.resolve({ _id: 'existing' }) });

    const result = await service.handleDelivery({
      rawBody: Buffer.from('x'),
      signature: 'good-signature',
      eventId: 'evt_3',
      body: capturedPayload,
    });

    expect(result.outcome).toBe('duplicate_ignored');
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
    expect(metrics.snapshot().counters['webhook_duplicate_events_total']).toBe(1);
  });

  it('logs payment.failed for audit but does not call applyPaymentCaptured (retryable checkout, not a terminal state)', async () => {
    const result = await service.handleDelivery({
      rawBody: Buffer.from('x'),
      signature: 'good-signature',
      eventId: 'evt_4',
      body: { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_failed', order_id: 'order_test123' } } } },
    });

    expect(result.outcome).toBe('logged_no_transition');
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
  });

  it('treats order.paid the same as payment.captured — both route through the same idempotent function', async () => {
    await service.handleDelivery({
      rawBody: Buffer.from('x'),
      signature: 'good-signature',
      eventId: 'evt_5',
      body: { event: 'order.paid', payload: { payment: { entity: { id: 'pay_abc', order_id: 'order_test123', amount: 50000 } } } },
    });
    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledTimes(1);
  });

  it('handles a malformed payload (missing payment entity) without throwing', async () => {
    const result = await service.handleDelivery({
      rawBody: Buffer.from('x'),
      signature: 'good-signature',
      eventId: 'evt_6',
      body: { event: 'payment.captured', payload: {} },
    });
    expect(result.outcome).toBe('malformed_payload');
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
  });
});
