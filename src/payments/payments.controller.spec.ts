import { PaymentsController } from './payments.controller';
import { PaymentEventOutcome, PaymentEventSource } from './schemas/payment-event.schema';
import { OrderStatus, PaymentStatus } from '../orders/schemas/order.schema';
import { PaymentMetricsService } from './payment-metrics.service';
import { BadRequestException } from '@nestjs/common';

/**
 * A minimal in-memory Order model for testing /payments/initiate's
 * race-safe reuse logic. `doc` is held by reference (not copied) so tests
 * can mutate it mid-flow to simulate a concurrent request winning a race —
 * findOneAndUpdate reproduces real MongoDB semantics: the write only
 * applies (and only then is a match returned) if the filter still holds at
 * the moment it runs.
 */
class FakeInitiateOrderModel {
  constructor(private doc: Record<string, any> | null) {}

  async findById(id: any) {
    if (!this.doc || this.doc._id !== id) return null;
    return { ...this.doc };
  }

  async findOneAndUpdate(filter: any, update: any) {
    if (!this.doc || this.doc._id !== filter._id) return null;
    const expected = filter.razorpayOrderId;
    const matches =
      expected && typeof expected === 'object' && '$exists' in expected
        ? expected.$exists === false
          ? this.doc.razorpayOrderId === undefined
          : this.doc.razorpayOrderId !== undefined
        : this.doc.razorpayOrderId === expected;
    if (!matches) return null;
    Object.assign(this.doc, update.$set ?? {});
    return { ...this.doc };
  }
}

function makeInitiateOrder(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    _id: 'order-1',
    userId: 'user-1',
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.PENDING,
    billAmount: 500,
    razorpayOrderId: undefined as string | undefined,
    ...overrides,
  };
}

describe('PaymentsController — /payments/verify', () => {
  let orderModel: { findById: jest.Mock };
  let paymentsService: { verifyPayment: jest.Mock; createOrder: jest.Mock };
  let ordersService: any;
  let paymentFinalization: { applyPaymentCaptured: jest.Mock };
  let webhookService: { handleDelivery: jest.Mock };
  let metrics: PaymentMetricsService;
  let configService: { get: jest.Mock };
  let controller: PaymentsController;

  const user = { sub: 'user-1' };
  const order = { _id: 'order-1', userId: 'user-1', razorpayOrderId: 'order_test123' };
  const req = { requestId: 'req-1' } as any;

  beforeEach(() => {
    orderModel = { findById: jest.fn().mockResolvedValue(order) };
    paymentsService = { verifyPayment: jest.fn().mockReturnValue(true), createOrder: jest.fn() };
    ordersService = {};
    paymentFinalization = {
      applyPaymentCaptured: jest.fn().mockResolvedValue({
        applied: true,
        outcome: PaymentEventOutcome.APPLIED,
        order: { ...order, paymentStatus: PaymentStatus.COMPLETED },
      }),
    };
    webhookService = { handleDelivery: jest.fn().mockResolvedValue({ received: true, outcome: 'applied' }) };
    metrics = new PaymentMetricsService();
    configService = { get: jest.fn().mockReturnValue(undefined) };
    controller = new PaymentsController(
      paymentsService as any,
      ordersService,
      paymentFinalization as any,
      webhookService as any,
      metrics,
      configService as any,
      orderModel as any,
    );
  });

  const body = {
    orderId: 'order-1',
    razorpayOrderId: 'order_test123',
    razorpayPaymentId: 'pay_abc',
    razorpaySignature: 'sig',
  };

  it('verifies and finalizes on a normal call', async () => {
    const result = await controller.verifyPayment(body, user, req);
    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayOrderId: 'order_test123',
        razorpayPaymentId: 'pay_abc',
        source: PaymentEventSource.VERIFY,
        requestId: 'req-1',
      }),
    );
  });

  it('rejects an invalid signature before ever touching the order', async () => {
    paymentsService.verifyPayment.mockReturnValue(false);
    await expect(controller.verifyPayment(body, user, req)).rejects.toThrow(BadRequestException);
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled();
  });

  it('rejects when the order does not belong to the requesting user', async () => {
    orderModel.findById.mockResolvedValue({ ...order, userId: 'someone-else' });
    await expect(controller.verifyPayment(body, user, req)).rejects.toThrow(BadRequestException);
  });

  it('rejects when the orderId and razorpayOrderId presented don\'t actually correspond to each other', async () => {
    orderModel.findById.mockResolvedValue({ ...order, razorpayOrderId: 'order_totally_different' });
    await expect(controller.verifyPayment(body, user, req)).rejects.toThrow(BadRequestException);
  });

  it('rejects a request missing required fields without reaching the signature check', async () => {
    await expect(controller.verifyPayment({ ...body, razorpaySignature: '' }, user, req)).rejects.toThrow(
      BadRequestException,
    );
    expect(paymentsService.verifyPayment).not.toHaveBeenCalled();
  });

  it('double-click Pay / two browser tabs: two concurrent verify calls for the same payment both succeed at the HTTP layer, but only one performed the transition', async () => {
    // Second call simulates arriving after the first already won.
    paymentFinalization.applyPaymentCaptured
      .mockResolvedValueOnce({ applied: true, outcome: PaymentEventOutcome.APPLIED, order: { ...order, paymentStatus: PaymentStatus.COMPLETED } })
      .mockResolvedValueOnce({ applied: false, outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL, order: { ...order, paymentStatus: PaymentStatus.COMPLETED } });

    const [first, second] = await Promise.all([
      controller.verifyPayment(body, user, req),
      controller.verifyPayment(body, user, req),
    ]);

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(first.order.paymentStatus).toBe(PaymentStatus.COMPLETED);
    expect(second.order.paymentStatus).toBe(PaymentStatus.COMPLETED);
  });

  it('customer retries payment after a browser refresh — a later verify call for the same order+payment reports alreadyProcessed instead of erroring', async () => {
    paymentFinalization.applyPaymentCaptured.mockResolvedValue({
      applied: false,
      outcome: PaymentEventOutcome.NOOP_ALREADY_FINAL,
      order: { ...order, paymentStatus: PaymentStatus.COMPLETED },
    });
    const result = await controller.verifyPayment(body, user, req);
    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(true);
  });
});

describe('PaymentsController — /payments/webhook/razorpay', () => {
  function buildController(webhookEnabledFlag: string | undefined) {
    const webhookService = { handleDelivery: jest.fn().mockResolvedValue({ received: true, outcome: 'applied' }) };
    const metrics = new PaymentMetricsService();
    const configService = { get: jest.fn().mockReturnValue(webhookEnabledFlag) };
    const controller = new PaymentsController(
      {} as any,
      {} as any,
      {} as any,
      webhookService as any,
      metrics,
      configService as any,
      {} as any,
    );
    return { controller, webhookService, metrics };
  }

  it('delegates the raw body, signature, and event id straight through to the webhook service', async () => {
    const { controller, webhookService } = buildController(undefined);
    const req = { rawBody: Buffer.from('x'), body: { event: 'payment.captured' }, requestId: 'req-9' } as any;

    const result = await controller.handleRazorpayWebhook(req, 'sig-123', 'evt-123');

    expect(result).toEqual({ received: true, outcome: 'applied' });
    expect(webhookService.handleDelivery).toHaveBeenCalledWith({
      rawBody: req.rawBody,
      signature: 'sig-123',
      eventId: 'evt-123',
      body: req.body,
      requestId: 'req-9',
    });
  });

  it('the PAYMENT_WEBHOOK_ENABLED kill switch stops processing without touching the webhook service, and still acks 200', async () => {
    const { controller, webhookService, metrics } = buildController('false');
    const req = { rawBody: Buffer.from('x'), body: { event: 'payment.captured' }, requestId: 'req-9' } as any;

    const result = await controller.handleRazorpayWebhook(req, 'sig-123', 'evt-123');

    expect(result).toEqual({ received: true, outcome: 'disabled' });
    expect(webhookService.handleDelivery).not.toHaveBeenCalled();
    expect(metrics.snapshot().counters['webhook_disabled_by_flag_total']).toBe(1);
  });

  it('defaults to enabled when the flag is unset (only the literal string "false" disables it)', async () => {
    const { controller, webhookService } = buildController(undefined);
    const req = { rawBody: Buffer.from('x'), body: {}, requestId: 'req-1' } as any;
    await controller.handleRazorpayWebhook(req, 'sig', 'evt');
    expect(webhookService.handleDelivery).toHaveBeenCalled();
  });
});

describe('PaymentsController — /payments/initiate/:orderId hardening', () => {
  let paymentsService: { createOrder: jest.Mock; fetchOrder: jest.Mock; fetchOrderPayments: jest.Mock; verifyPayment: jest.Mock };
  let paymentFinalization: { applyPaymentCaptured: jest.Mock };
  let controller: PaymentsController;
  const user = { sub: 'user-1' };
  const req = { requestId: 'req-1' } as any;

  function build(orderRef: Record<string, any>) {
    paymentsService = {
      createOrder: jest.fn(),
      fetchOrder: jest.fn(),
      fetchOrderPayments: jest.fn(),
      verifyPayment: jest.fn(),
    };
    paymentFinalization = { applyPaymentCaptured: jest.fn() };
    const orderModel = new FakeInitiateOrderModel(orderRef);
    controller = new PaymentsController(
      paymentsService as any,
      {} as any,
      paymentFinalization as any,
      {} as any,
      new PaymentMetricsService(),
      { get: jest.fn() } as any,
      orderModel as any,
    );
    return orderModel;
  }

  it('first-ever "Pay Now" (no prior razorpayOrderId) mints and persists a new order, unchanged from before', async () => {
    const orderRef = makeInitiateOrder();
    build(orderRef);
    paymentsService.createOrder.mockResolvedValue({ id: 'order_new1', amount: 50000, currency: 'INR' });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result).toEqual({ orderId: 'order-1', razorpayOrderId: 'order_new1', amount: 50000, currency: 'INR' });
    expect(orderRef.razorpayOrderId).toBe('order_new1');
    expect(paymentsService.createOrder).toHaveBeenCalledTimes(1);
    expect(paymentFinalization.applyPaymentCaptured).not.toHaveBeenCalled(); // nothing to check yet
  });

  it('repeated tap on a still-live, unpaid, same-amount order reuses it — no new Razorpay order minted', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_existing' });
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_existing', amount: 50000, currency: 'INR', status: 'created', created_at: Math.floor(Date.now() / 1000) - 60,
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result).toEqual({ orderId: 'order-1', razorpayOrderId: 'order_existing', amount: 50000, currency: 'INR' });
    expect(paymentsService.createOrder).not.toHaveBeenCalled();
  });

  it('calling it 3 times in a row on a reusable order returns the identical razorpayOrderId every time and never mints', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_existing' });
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_existing', amount: 50000, currency: 'INR', status: 'created', created_at: Math.floor(Date.now() / 1000) - 60,
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });

    const results = await Promise.all([
      controller.initiatePaymentForOrder('order-1', user, req),
      controller.initiatePaymentForOrder('order-1', user, req),
      controller.initiatePaymentForOrder('order-1', user, req),
    ]);

    results.forEach((r) => expect(r.razorpayOrderId).toBe('order_existing'));
    expect(paymentsService.createOrder).not.toHaveBeenCalled();
  });

  it('the ₹500-incident scenario: a repeated tap discovers the prior order was actually captured, finalizes it, and refuses to mint a new one', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_actually_paid' });
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_actually_paid', amount: 50000, currency: 'INR', status: 'paid', created_at: Math.floor(Date.now() / 1000) - 120,
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({
      items: [{ id: 'pay_real', status: 'captured', amount: 50000 }],
    });
    paymentFinalization.applyPaymentCaptured.mockResolvedValue({
      applied: true,
      outcome: PaymentEventOutcome.APPLIED,
      order: { ...orderRef, paymentStatus: PaymentStatus.COMPLETED },
    });

    await expect(controller.initiatePaymentForOrder('order-1', user, req)).rejects.toThrow(
      'Payment has already been completed for this order.',
    );

    expect(paymentFinalization.applyPaymentCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ razorpayOrderId: 'order_actually_paid', razorpayPaymentId: 'pay_real', amountPaise: 50000 }),
    );
    expect(paymentsService.createOrder).not.toHaveBeenCalled();
  });

  it('a captured payment that applyPaymentCaptured could not complete (e.g. flagged for manual review) blocks minting rather than papering over it', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_flagged' });
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_flagged', amount: 50000, currency: 'INR', status: 'paid', created_at: Math.floor(Date.now() / 1000),
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({
      items: [{ id: 'pay_mismatch', status: 'captured', amount: 999900 }],
    });
    paymentFinalization.applyPaymentCaptured.mockResolvedValue({
      applied: false,
      outcome: PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH,
      order: { ...orderRef, paymentStatus: PaymentStatus.PENDING, needsManualReview: true },
    });

    await expect(controller.initiatePaymentForOrder('order-1', user, req)).rejects.toThrow(
      'This order has a payment issue that needs review — please contact support.',
    );
    expect(paymentsService.createOrder).not.toHaveBeenCalled();
  });

  it('a genuinely stale prior order (older than the reuse window, never paid) gets replaced with a fresh one', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_stale' });
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_stale', amount: 50000, currency: 'INR', status: 'created',
      created_at: Math.floor((Date.now() - 60 * 60 * 1000) / 1000), // 1 hour old
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });
    paymentsService.createOrder.mockResolvedValue({ id: 'order_fresh', amount: 50000, currency: 'INR' });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result.razorpayOrderId).toBe('order_fresh');
    expect(orderRef.razorpayOrderId).toBe('order_fresh');
    expect(paymentsService.createOrder).toHaveBeenCalledTimes(1);
  });

  it('a prior order whose amount no longer matches the current bill (re-itemized) is replaced even though it is fresh and unpaid', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_old_amount', billAmount: 800 }); // admin changed the bill after this order was minted
    build(orderRef);
    paymentsService.fetchOrder.mockResolvedValue({
      id: 'order_old_amount', amount: 50000, currency: 'INR', status: 'created', created_at: Math.floor(Date.now() / 1000) - 30,
    });
    paymentsService.fetchOrderPayments.mockResolvedValue({ items: [] });
    paymentsService.createOrder.mockResolvedValue({ id: 'order_new_amount', amount: 80000, currency: 'INR' });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result.razorpayOrderId).toBe('order_new_amount');
    expect(paymentsService.createOrder).toHaveBeenCalledWith(800, 'order-1');
  });

  it('if the Razorpay check itself fails (API down), it fails open — mints a fresh order rather than 500ing on the customer', async () => {
    const orderRef = makeInitiateOrder({ razorpayOrderId: 'order_unreachable' });
    build(orderRef);
    paymentsService.fetchOrder.mockRejectedValue(new Error('Razorpay API timeout'));
    paymentsService.fetchOrderPayments.mockRejectedValue(new Error('Razorpay API timeout'));
    paymentsService.createOrder.mockResolvedValue({ id: 'order_fallback', amount: 50000, currency: 'INR' });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result.razorpayOrderId).toBe('order_fallback');
  });

  it('double-click race: two concurrent first-time initiate calls only let one write win, and the loser defers to the winner instead of returning its own orphaned mint', async () => {
    const orderRef = makeInitiateOrder(); // no razorpayOrderId yet — both calls will try to mint
    build(orderRef);

    // Simulate a concurrent request's write landing first, right as our own
    // createOrder call resolves — by the time we try to persist, the filter
    // (razorpayOrderId still absent) no longer matches.
    paymentsService.createOrder.mockImplementationOnce(async () => {
      orderRef.razorpayOrderId = 'order_concurrent_winner';
      return { id: 'order_orphaned_mine', amount: 50000, currency: 'INR' };
    });

    const result = await controller.initiatePaymentForOrder('order-1', user, req);

    expect(result.razorpayOrderId).toBe('order_concurrent_winner');
    expect(orderRef.razorpayOrderId).toBe('order_concurrent_winner'); // DB reflects only the winner, never both
  });

  it('if the concurrent winner had actually already completed the order by the time we lose the race, we surface that instead of a stale amount', async () => {
    const orderRef = makeInitiateOrder();
    build(orderRef);
    paymentsService.createOrder.mockImplementationOnce(async () => {
      orderRef.razorpayOrderId = 'order_winner';
      orderRef.paymentStatus = PaymentStatus.COMPLETED;
      return { id: 'order_orphaned_mine', amount: 50000, currency: 'INR' };
    });

    await expect(controller.initiatePaymentForOrder('order-1', user, req)).rejects.toThrow(
      'Payment has already been completed for this order.',
    );
  });
});
