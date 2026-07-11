import { OrderStatus, PaymentStatus } from '../../orders/schemas/order.schema';

/**
 * A minimal in-memory stand-in for Mongoose's Order model that reproduces
 * the one behavior these tests actually depend on: findOneAndUpdate with a
 * filter is atomic and conditional — it only applies $set (and reports a
 * match) when the filter still holds at the moment it runs. That's the
 * exact primitive PaymentFinalizationService relies on to guarantee "exactly
 * one caller wins," so the fake has to get this right rather than always
 * succeeding like a naive mock would.
 */
export function makeFakeOrder(overrides: Record<string, any> = {}) {
  return {
    _id: 'order-1',
    userId: 'user-1',
    orderNumber: 'LB00001',
    totalAmount: 500,
    billAmount: 500,
    razorpayOrderId: 'order_test123',
    razorpayPaymentId: undefined,
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.PENDING,
    deliveryOtp: undefined,
    needsManualReview: false,
    createdAt: new Date(),
    ...overrides,
  };
}

export class FakeOrderModel {
  constructor(private store: { current: Record<string, any> | null }) {}

  async findOne(filter: any) {
    const doc = this.store.current;
    if (!doc) return null;
    if (filter.razorpayOrderId && doc.razorpayOrderId !== filter.razorpayOrderId) return null;
    return { ...doc };
  }

  async findById(id: any) {
    const doc = this.store.current;
    if (!doc || doc._id !== id) return null;
    return { ...doc };
  }

  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.store.current;
    if (!doc) return null;
    if (filter._id !== undefined && doc._id !== filter._id) return null;

    // Reproduce the { paymentStatus: { $ne: COMPLETED } } guard atomically.
    if (filter.paymentStatus?.$ne !== undefined && doc.paymentStatus === filter.paymentStatus.$ne) {
      return null; // filter didn't match — no update applied, mirrors real Mongo semantics
    }

    Object.assign(doc, update.$set ?? {});
    this.store.current = doc;
    return { ...doc };
  }

  async updateOne(filter: any, update: any) {
    const doc = this.store.current;
    if (!doc || doc._id !== filter._id) return { matchedCount: 0 };
    Object.assign(doc, update.$set ?? {});
    return { matchedCount: 1 };
  }

  async countDocuments() {
    return this.store.current ? 1 : 0;
  }

  find() {
    const results = this.store.current ? [{ ...this.store.current }] : [];
    return { limit: () => Promise.resolve(results) } as any;
  }
}
