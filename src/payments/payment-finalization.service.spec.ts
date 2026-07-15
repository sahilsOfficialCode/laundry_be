import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentEventOutcome, PaymentEventSource } from './schemas/payment-event.schema';
import { PaymentStatus } from '../orders/schemas/order.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';
import { FakeOrderModel, makeFakeOrder } from './test-utils/fake-order-model';

describe('PaymentFinalizationService — applyPaymentCaptured', () => {
  let store: { current: Record<string, any> | null };
  let orderModel: FakeOrderModel;
  let paymentEventModel: { create: jest.Mock };
  let notificationsService: { notifyPaymentSuccess: jest.Mock; notifyAdmin: jest.Mock };
  let metrics: PaymentMetricsService;
  let alerts: PaymentAlertsService;
  let couponsService: { finalizeRedemption: jest.Mock };
  let service: PaymentFinalizationService;

  const baseInput = {
    razorpayOrderId: 'order_test123',
    razorpayPaymentId: 'pay_abc',
    eventType: 'payment.captured',
    source: PaymentEventSource.WEBHOOK,
  };

  beforeEach(() => {
    store = { current: makeFakeOrder() };
    orderModel = new FakeOrderModel(store);
    paymentEventModel = { create: jest.fn().mockResolvedValue({}) };
    notificationsService = {
      notifyPaymentSuccess: jest.fn().mockResolvedValue(undefined),
      notifyAdmin: jest.fn().mockResolvedValue(undefined),
    };
    metrics = new PaymentMetricsService();
    alerts = new PaymentAlertsService();
    couponsService = { finalizeRedemption: jest.fn().mockResolvedValue({ redeemed: false }) };
    service = new PaymentFinalizationService(
      orderModel as any,
      paymentEventModel as any,
      notificationsService as any,
      metrics,
      alerts,
      couponsService as any,
    );
  });

  it('completes a pending order on first application (happy path)', async () => {
    const result = await service.applyPaymentCaptured(baseInput);
    expect(result.applied).toBe(true);
    expect(result.outcome).toBe(PaymentEventOutcome.APPLIED);
    expect(result.order!.paymentStatus).toBe(PaymentStatus.COMPLETED);
    expect(result.order!.razorpayPaymentId).toBe('pay_abc');
    expect(result.order!.deliveryOtp).toMatch(/^\d{4}$/);
    expect(notificationsService.notifyPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyAdmin).toHaveBeenCalledTimes(1);
  });

  it('calling verify 1x, 2x, and 100x for the same payment produces an identical end state with side effects fired exactly once', async () => {
    const calls = Array.from({ length: 100 }, () =>
      service.applyPaymentCaptured({ ...baseInput, source: PaymentEventSource.VERIFY }),
    );
    const results = await Promise.all(calls);

    const appliedCount = results.filter((r) => r.applied).length;
    expect(appliedCount).toBe(1);
    expect(notificationsService.notifyPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyAdmin).toHaveBeenCalledTimes(1);
    expect(store.current!.deliveryOtp).toMatch(/^\d{4}$/);

    // Every single call — including the 99 that lost — reports the same final state.
    for (const r of results) {
      expect(r.order!.paymentStatus).toBe(PaymentStatus.COMPLETED);
    }
  });

  it('webhook first, then verify — verify becomes a no-op and does not re-fire notifications', async () => {
    const webhookResult = await service.applyPaymentCaptured({ ...baseInput, source: PaymentEventSource.WEBHOOK });
    const verifyResult = await service.applyPaymentCaptured({ ...baseInput, source: PaymentEventSource.VERIFY });

    expect(webhookResult.applied).toBe(true);
    expect(verifyResult.applied).toBe(false);
    expect(verifyResult.outcome).toBe(PaymentEventOutcome.NOOP_ALREADY_FINAL);
    expect(notificationsService.notifyPaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('verify first, then webhook — webhook becomes a no-op', async () => {
    const verifyResult = await service.applyPaymentCaptured({ ...baseInput, source: PaymentEventSource.VERIFY });
    const webhookResult = await service.applyPaymentCaptured({ ...baseInput, source: PaymentEventSource.WEBHOOK });

    expect(verifyResult.applied).toBe(true);
    expect(webhookResult.applied).toBe(false);
    expect(webhookResult.outcome).toBe(PaymentEventOutcome.NOOP_ALREADY_FINAL);
  });

  it('same webhook event delivered 20 times all resolve to one applied + nineteen no-ops', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.applyPaymentCaptured(baseInput)),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => r.outcome === PaymentEventOutcome.NOOP_ALREADY_FINAL)).toHaveLength(19);
  });

  it('a second, different payment captured against an already-paid order is flagged for manual review, not silently dropped', async () => {
    await service.applyPaymentCaptured(baseInput); // first payment completes the order
    const secondResult = await service.applyPaymentCaptured({
      ...baseInput,
      razorpayPaymentId: 'pay_different_xyz', // customer retried and paid again
    });

    expect(secondResult.applied).toBe(false);
    expect(secondResult.outcome).toBe(PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED);
    expect(store.current!.needsManualReview).toBe(true);
    expect(store.current!.razorpayPaymentId).toBe('pay_abc'); // original payment id is not clobbered
  });

  it('rejects and flags a captured amount that does not match the billed amount (tampered/mismatched payload)', async () => {
    const result = await service.applyPaymentCaptured({
      ...baseInput,
      amountPaise: 12345, // order.billAmount is 500 => expected 50000 paise
    });

    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH);
    expect(store.current!.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(store.current!.needsManualReview).toBe(true);
  });

  it('accepts a captured amount that matches the billed amount exactly', async () => {
    const result = await service.applyPaymentCaptured({ ...baseInput, amountPaise: 50000 });
    expect(result.applied).toBe(true);
  });

  it('returns order_not_found for a razorpayOrderId with no matching order (payment captured after order deleted/expired from our view)', async () => {
    const result = await service.applyPaymentCaptured({ ...baseInput, razorpayOrderId: 'order_unknown' });
    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.ORDER_NOT_FOUND);
    expect(result.order).toBeNull();
  });

  it('payment captured after the order was already cancelled is rejected and flagged, not silently marked paid', async () => {
    store.current = makeFakeOrder({ status: 'CANCELLED' as any });
    const result = await service.applyPaymentCaptured(baseInput);
    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.REJECTED_ORDER_CANCELLED);
    expect(store.current!.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(store.current!.needsManualReview).toBe(true);
  });

  it('a Mongo write failure while logging the event does not prevent the payment itself from being recorded as completed', async () => {
    paymentEventModel.create.mockRejectedValueOnce(new Error('mongo write failed'));
    const result = await service.applyPaymentCaptured(baseInput);
    expect(result.applied).toBe(true);
    expect(store.current!.paymentStatus).toBe(PaymentStatus.COMPLETED);
  });

  it('a notification failure does not throw out of applyPaymentCaptured (payment success must not depend on notification delivery)', async () => {
    notificationsService.notifyPaymentSuccess.mockRejectedValueOnce(new Error('fcm down'));
    await expect(service.applyPaymentCaptured(baseInput)).resolves.toMatchObject({ applied: true });
  });

  it('resolves without waiting for the audit-log write — the webhook ack (and this response) must never be slowed by a slow PaymentEvent write', async () => {
    let resolveCreate!: () => void;
    paymentEventModel.create.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = () => resolve({}); }),
    );

    const result = await service.applyPaymentCaptured(baseInput);

    expect(result.applied).toBe(true); // resolved even though paymentEventModel.create() is still pending
    resolveCreate(); // let the background write finish so it doesn't leak into other tests
  });

  it('a duplicate-key error on the audit log (expected webhook redelivery) is not retried and is not counted as a logging failure', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    paymentEventModel.create.mockRejectedValueOnce(duplicateKeyError);

    await service.applyPaymentCaptured(baseInput);
    await new Promise((resolve) => setImmediate(resolve)); // let the fire-and-forget logEvent settle

    expect(paymentEventModel.create).toHaveBeenCalledTimes(1); // no retry attempted
    expect(metrics.snapshot().counters['payment_event_log_failures_total']).toBeUndefined();
  });

  it('a real (non-duplicate-key) audit-log failure gets one retry, and is counted if that also fails', async () => {
    paymentEventModel.create.mockRejectedValue(new Error('connection reset'));

    await service.applyPaymentCaptured(baseInput);
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the fire-and-forget retry (250ms backoff) settle

    expect(paymentEventModel.create).toHaveBeenCalledTimes(2); // original attempt + one retry
    expect(metrics.snapshot().counters['payment_event_log_failures_total']).toBe(1);
  });
});
