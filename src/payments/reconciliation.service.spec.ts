import { ReconciliationService } from './reconciliation.service';
import { PaymentStatus } from '../orders/schemas/order.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';

function pendingOrder(overrides: Record<string, any> = {}) {
  return {
    _id: 'order-1',
    razorpayOrderId: 'order_test123',
    paymentStatus: PaymentStatus.PENDING,
    needsManualReview: false,
    createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes old — past the grace period
    ...overrides,
  };
}

describe('ReconciliationService', () => {
  let orderModel: any;
  let paymentsService: { fetchOrderPayments: jest.Mock };
  let paymentFinalization: { applyPaymentCaptured: jest.Mock };
  let metrics: PaymentMetricsService;
  let alerts: PaymentAlertsService;
  let service: ReconciliationService;
  let updateOneMock: jest.Mock;
  let findMock: jest.Mock;
  let configService: { get: jest.Mock };

  function buildWithCandidates(candidates: any[]) {
    updateOneMock = jest.fn().mockResolvedValue({ matchedCount: 1 });
    findMock = jest.fn().mockReturnValue({ limit: () => Promise.resolve(candidates) });
    orderModel = {
      find: findMock,
      countDocuments: jest.fn().mockResolvedValue(0),
      updateOne: updateOneMock,
    };
    paymentsService = { fetchOrderPayments: jest.fn() };
    paymentFinalization = { applyPaymentCaptured: jest.fn() };
    metrics = new PaymentMetricsService();
    alerts = new PaymentAlertsService();
    configService = { get: jest.fn().mockReturnValue(undefined) };
    service = new ReconciliationService(
      orderModel,
      paymentsService as any,
      paymentFinalization as any,
      metrics,
      alerts,
      configService as any,
    );
  }

  it('repairs an order whose payment Razorpay reports as captured but our DB never learned about — the exact ₹500 incident', async () => {
    const order = pendingOrder();
    buildWithCandidates([order]);
    paymentsService.fetchOrderPayments.mockResolvedValue({
      items: [{ id: 'pay_recovered', status: 'captured', amount: 50000 }],
    });
    paymentFinalization.applyPaymentCaptured.mockResolvedValue({ applied: true, outcome: 'applied', order });

    await service.reconcilePendingPayments();

    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayOrderId: 'order_test123',
        razorpayPaymentId: 'pay_recovered',
        amountPaise: 50000,
        source: 'reconciliation',
      }),
    );
    expect(metrics.snapshot().counters['payment_reconciliation_repairs_total']).toBe(1);
  });

  it('leaves a genuinely still-pending order alone (no captured payment at Razorpay yet, under 24h old)', async () => {
    buildWithCandidates([pendingOrder()]);
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });

    await service.reconcilePendingPayments();

    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('flags needsManualReview after 24h with still no captured payment found, and never leaves it unflagged silently', async () => {
    buildWithCandidates([pendingOrder({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })]);
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });

    await service.reconcilePendingPayments();

    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: 'order-1' },
      expect.objectContaining({ $set: expect.objectContaining({ needsManualReview: true }) }),
    );
  });

  it('one order failing its Razorpay lookup does not abort reconciliation for the rest of the run', async () => {
    const good = pendingOrder({ _id: 'order-2', razorpayOrderId: 'order_good' });
    buildWithCandidates([pendingOrder(), good]);
    paymentsService.fetchOrderPayments
      .mockRejectedValueOnce(new Error('Razorpay API timeout'))
      .mockResolvedValueOnce({ items: [{ id: 'pay_good', status: 'captured', amount: 50000 }] });
    paymentFinalization.applyPaymentCaptured.mockResolvedValue({ applied: true, outcome: 'applied', order: good });

    await expect(service.reconcilePendingPayments()).resolves.not.toThrow();
    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledTimes(1);
  });

  it('skips a run entirely if the previous run is still in progress (no overlapping cron executions)', async () => {
    buildWithCandidates([pendingOrder()]);
    paymentsService.fetchOrderPayments.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 20)),
    );

    const first = service.reconcilePendingPayments();
    const second = service.reconcilePendingPayments(); // fired while `first` is still running
    await Promise.all([first, second]);

    // find() is only called once per actual run; the overlapping call bails out early.
    expect(orderModel.find).toHaveBeenCalledTimes(1);
  });

  it('excludes orders already flagged needsManualReview from the sweep — the dead-letter exit, so flagged orders stop burning Razorpay API calls forever', async () => {
    buildWithCandidates([]);
    await service.reconcilePendingPayments();

    expect(findMock).toHaveBeenCalledWith(
      expect.objectContaining({ needsManualReview: { $ne: true } }),
    );
  });

  it('trips the circuit breaker after 5 consecutive Razorpay lookup failures and stops the run early, leaving the rest for the next tick', async () => {
    const orders = Array.from({ length: 8 }, (_, i) => pendingOrder({ _id: `order-${i}`, razorpayOrderId: `order_rp_${i}` }));
    buildWithCandidates(orders);
    paymentsService.fetchOrderPayments.mockRejectedValue(new Error('Razorpay API is down'));

    await service.reconcilePendingPayments();

    // Only the first 5 (the threshold) are attempted before the breaker trips.
    expect(paymentsService.fetchOrderPayments).toHaveBeenCalledTimes(5);
  });

  it('a lookup success resets the consecutive-failure counter, so intermittent per-order failures never trip the breaker', async () => {
    const orders = Array.from({ length: 10 }, (_, i) => pendingOrder({ _id: `order-${i}`, razorpayOrderId: `order_rp_${i}` }));
    buildWithCandidates(orders);
    let call = 0;
    paymentsService.fetchOrderPayments.mockImplementation(() => {
      call++;
      // Every other call fails — never 5 in a row.
      return call % 2 === 0 ? Promise.reject(new Error('flaky')) : Promise.resolve({ items: [] });
    });

    await service.reconcilePendingPayments();

    expect(paymentsService.fetchOrderPayments).toHaveBeenCalledTimes(10);
  });

  it('the PAYMENT_RECONCILIATION_ENABLED kill switch skips the entire run', async () => {
    buildWithCandidates([pendingOrder()]);
    configService.get.mockReturnValue('false');

    await service.reconcilePendingPayments();

    expect(findMock).not.toHaveBeenCalled();
  });

  it('runs once on application bootstrap, and does not return a Promise Nest would block startup on', async () => {
    buildWithCandidates([pendingOrder()]);
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });

    // Fire-and-forget: the method itself must return synchronously (void),
    // not a Promise — if it did, Nest would await it during bootstrap and a
    // slow/down Razorpay API would delay app.listen() for everything.
    const returnValue = service.onApplicationBootstrap();
    expect(returnValue).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(findMock).toHaveBeenCalledTimes(1);
  });
});
