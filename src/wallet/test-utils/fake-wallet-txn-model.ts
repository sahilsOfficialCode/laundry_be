import { WalletTxnCategory, WalletTxnStatus, WalletTxnType } from '../schemas/wallet-transaction.schema';

/**
 * A minimal in-memory stand-in for Mongoose's WalletTransaction model,
 * mirroring payments/test-utils/fake-order-model.ts: the one behavior these
 * tests actually depend on is that findOneAndUpdate with a filter is atomic
 * and conditional — it only applies $set (and reports a match) when the
 * filter still holds at the moment it runs. That's the exact primitive
 * WalletService.applyTopUpCaptured relies on to guarantee "exactly one
 * caller wins."
 */
export function makeFakeWalletTxn(overrides: Record<string, any> = {}) {
  return {
    _id: 'txn-1',
    userId: 'user-1',
    type: WalletTxnType.CREDIT,
    amount: 698,
    description: 'Wallet top-up of ₹698',
    razorpayOrderId: 'order_TRfT5V',
    razorpayPaymentId: undefined,
    status: WalletTxnStatus.PENDING,
    category: WalletTxnCategory.TOPUP,
    needsManualReview: false,
    createdAt: new Date(),
    ...overrides,
  };
}

export class FakeWalletTxnModel {
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
    // Mongoose document stand-in: mutating fields on the returned object and
    // calling .save() writes back to the store, mirroring verifyAddMoney's
    // `txn.status = FAILED; await txn.save();` usage.
    const self = this.store;
    const proxy = { ...doc };
    Object.defineProperty(proxy, 'save', {
      enumerable: false,
      value: async () => {
        Object.assign(doc, proxy);
        delete (doc as any).save;
        self.current = doc;
      },
    });
    return proxy;
  }

  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.store.current;
    if (!doc) return null;
    if (filter._id !== undefined && doc._id !== filter._id) return null;

    // Reproduce the { status: PENDING } guard atomically.
    if (filter.status !== undefined && doc.status !== filter.status) {
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

  find() {
    const results = this.store.current ? [{ ...this.store.current }] : [];
    return {
      sort: () => ({
        limit: () => ({ lean: () => Promise.resolve(results) }),
        lean: () => Promise.resolve(results),
      }),
    } as any;
  }
}

export class FakeUserModel {
  constructor(private store: { balance: number }) {}

  findById(_id: any) {
    const balance = this.store.balance;
    return { select: () => ({ lean: () => Promise.resolve({ walletBalance: balance }) }) } as any;
  }

  async findByIdAndUpdate(_id: any, update: any, _opts: any) {
    if (update.$inc?.walletBalance !== undefined) {
      this.store.balance += update.$inc.walletBalance;
    }
    return { walletBalance: this.store.balance };
  }

  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    if (filter.walletBalance?.$gte !== undefined && this.store.balance < filter.walletBalance.$gte) {
      return null;
    }
    if (update.$inc?.walletBalance !== undefined) {
      this.store.balance += update.$inc.walletBalance;
    }
    return { walletBalance: this.store.balance };
  }
}
