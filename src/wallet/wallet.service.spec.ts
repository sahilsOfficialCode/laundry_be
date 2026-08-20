import { WalletService } from './wallet.service';
import { WalletTxnStatus } from './schemas/wallet-transaction.schema';
import { PaymentEventOutcome, PaymentEventSource } from '../payments/schemas/payment-event.schema';
import { PaymentMetricsService } from '../payments/payment-metrics.service';
import { PaymentAlertsService } from '../payments/payment-alerts.service';
import { FakeWalletTxnModel, FakeUserModel, makeFakeWalletTxn } from './test-utils/fake-wallet-txn-model';

describe('WalletService — applyTopUpCaptured', () => {
  let txnStore: { current: Record<string, any> | null };
  let userStore: { balance: number };
  let txnModel: FakeWalletTxnModel;
  let userModel: FakeUserModel;
  let paymentEventModel: { create: jest.Mock };
  let notificationsService: { notifyPaymentSuccess: jest.Mock };
  let metrics: PaymentMetricsService;
  let alerts: PaymentAlertsService;
  let paymentsService: { verifyPayment: jest.Mock };
  let couponsService: { finalizeRedemption: jest.Mock };
  let invoicesService: { generateForOrder: jest.Mock };
  let service: WalletService;

  const baseInput = {
    razorpayOrderId: 'order_TRfT5V',
    razorpayPaymentId: 'pay_TRfTCiX',
    eventType: 'payment.captured',
    source: PaymentEventSource.WEBHOOK,
  };

  beforeEach(() => {
    txnStore = { current: makeFakeWalletTxn() };
    userStore = { balance: 0 };
    txnModel = new FakeWalletTxnModel(txnStore);
    userModel = new FakeUserModel(userStore);
    paymentEventModel = { create: jest.fn().mockResolvedValue({}) };
    notificationsService = { notifyPaymentSuccess: jest.fn().mockResolvedValue(undefined) };
    metrics = new PaymentMetricsService();
    alerts = new PaymentAlertsService();
    paymentsService = { verifyPayment: jest.fn().mockReturnValue(true) };
    couponsService = { finalizeRedemption: jest.fn() };
    invoicesService = { generateForOrder: jest.fn() };
    service = new WalletService(
      txnModel as any,
      userModel as any,
      {} as any, // orderModel — unused by applyTopUpCaptured/verifyAddMoney
      paymentEventModel as any,
      paymentsService as any,
      notificationsService as any,
      couponsService as any,
      invoicesService as any,
      metrics,
      alerts,
    );
  });

  it('credits the wallet on first application — the exact repro for the ₹698 stuck top-up (order #LB31193)', async () => {
    const result = await service.applyTopUpCaptured(baseInput);

    expect(result.applied).toBe(true);
    expect(result.outcome).toBe(PaymentEventOutcome.APPLIED);
    expect(result.txn!.status).toBe(WalletTxnStatus.COMPLETED);
    expect(result.txn!.razorpayPaymentId).toBe('pay_TRfTCiX');
    expect(userStore.balance).toBe(698);
    expect(notificationsService.notifyPaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('webhook, verify, and reconciliation racing for the same top-up all resolve to one credit, not three', async () => {
    const calls = [
      service.applyTopUpCaptured({ ...baseInput, source: PaymentEventSource.WEBHOOK }),
      service.applyTopUpCaptured({ ...baseInput, source: PaymentEventSource.VERIFY }),
      service.applyTopUpCaptured({ ...baseInput, source: PaymentEventSource.RECONCILIATION }),
    ];
    const results = await Promise.all(calls);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(userStore.balance).toBe(698); // credited exactly once, not 3x698
  });

  it('this is the actual production bug: webhook fallback repairs a txn that verify never reached', async () => {
    // Simulates the customer's app dying right after Razorpay showed success —
    // verify is never called. The webhook fallback (or reconciliation) is the
    // only thing that can still complete this.
    const result = await service.applyTopUpCaptured({ ...baseInput, source: PaymentEventSource.WEBHOOK });
    expect(result.applied).toBe(true);
    expect(userStore.balance).toBe(698);
  });

  it('a second, different payment captured against an already-completed top-up is flagged for manual review, not silently dropped', async () => {
    await service.applyTopUpCaptured(baseInput);
    const secondResult = await service.applyTopUpCaptured({ ...baseInput, razorpayPaymentId: 'pay_different_xyz' });

    expect(secondResult.applied).toBe(false);
    expect(secondResult.outcome).toBe(PaymentEventOutcome.DUPLICATE_PAYMENT_FLAGGED);
    expect(txnStore.current!.needsManualReview).toBe(true);
    expect(userStore.balance).toBe(698); // not credited twice
  });

  it('rejects and flags a captured amount that does not match the top-up amount', async () => {
    const result = await service.applyTopUpCaptured({ ...baseInput, amountPaise: 12345 }); // txn.amount is 698 => expected 69800 paise

    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.REJECTED_AMOUNT_MISMATCH);
    expect(txnStore.current!.status).toBe(WalletTxnStatus.PENDING);
    expect(txnStore.current!.needsManualReview).toBe(true);
    expect(userStore.balance).toBe(0);
  });

  it('accepts a captured amount that matches the top-up amount exactly', async () => {
    const result = await service.applyTopUpCaptured({ ...baseInput, amountPaise: 69800 });
    expect(result.applied).toBe(true);
  });

  it('returns order_not_found for a razorpayOrderId with no matching wallet transaction (not a wallet top-up at all)', async () => {
    const result = await service.applyTopUpCaptured({ ...baseInput, razorpayOrderId: 'order_unknown' });
    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.ORDER_NOT_FOUND);
    expect(result.txn).toBeNull();
  });

  it('a payment captured for a txn already marked FAILED (bad signature earlier) is never auto-credited, only flagged', async () => {
    txnStore.current = makeFakeWalletTxn({ status: WalletTxnStatus.FAILED });
    const result = await service.applyTopUpCaptured(baseInput);

    expect(result.applied).toBe(false);
    expect(result.outcome).toBe(PaymentEventOutcome.REJECTED_ALREADY_FAILED);
    expect(txnStore.current!.needsManualReview).toBe(true);
    expect(userStore.balance).toBe(0);
  });

  describe('verifyAddMoney', () => {
    it('credits the wallet after a valid signature, delegating the write to applyTopUpCaptured', async () => {
      const result = await service.verifyAddMoney('user-1', {
        walletTxnId: 'txn-1',
        razorpayOrderId: 'order_TRfT5V',
        razorpayPaymentId: 'pay_TRfTCiX',
        razorpaySignature: 'sig',
      });

      expect(result.success).toBe(true);
      expect(result.balance).toBe(698);
      expect(txnStore.current!.status).toBe(WalletTxnStatus.COMPLETED);
    });

    it('marks the txn FAILED on an invalid signature and does not credit the wallet', async () => {
      paymentsService.verifyPayment.mockReturnValue(false);

      await expect(
        service.verifyAddMoney('user-1', {
          walletTxnId: 'txn-1',
          razorpayOrderId: 'order_TRfT5V',
          razorpayPaymentId: 'pay_TRfTCiX',
          razorpaySignature: 'bad-sig',
        }),
      ).rejects.toThrow('Invalid payment signature');

      expect(txnStore.current!.status).toBe(WalletTxnStatus.FAILED);
      expect(userStore.balance).toBe(0);
    });

    it('is idempotent — calling verify again after the wallet was already credited (e.g. by the webhook) just returns the current balance', async () => {
      txnStore.current = makeFakeWalletTxn({ status: WalletTxnStatus.COMPLETED });
      userStore.balance = 698;

      const result = await service.verifyAddMoney('user-1', {
        walletTxnId: 'txn-1',
        razorpayOrderId: 'order_TRfT5V',
        razorpayPaymentId: 'pay_TRfTCiX',
        razorpaySignature: 'sig',
      });

      expect(result.success).toBe(true);
      expect(result.balance).toBe(698);
      expect(userStore.balance).toBe(698); // not credited again
    });
  });
});
