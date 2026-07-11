import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnCategory,
  WalletTxnType,
  WalletTxnStatus,
} from './schemas/wallet-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
  PaymentStatus,
} from '../orders/schemas/order.schema';
import { PaymentsService } from '../payments/payments.service';
import { CreateAddMoneyOrderDto, VerifyAddMoneyDto } from './dto/add-money.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(WalletTransaction.name)
    private readonly txnModel: Model<WalletTransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── GET /wallet ────────────────────────────────────────────────────────────

  async getWallet(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('walletBalance')
      .lean();

    const transactions = await this.txnModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return {
      balance: user?.walletBalance ?? 0,
      transactions,
    };
  }

  // ── GET /wallet/transactions ────────────────────────────────────────────────

  async getAllTransactions(userId: string) {
    const transactions = await this.txnModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return { transactions };
  }

  // ── POST /wallet/add-money/create-order ────────────────────────────────────

  async createAddMoneyOrder(userId: string, dto: CreateAddMoneyOrderDto) {
    const { amount } = dto;

    if (amount < 1 || amount > 100000) {
      throw new BadRequestException('Amount must be between ₹1 and ₹1,00,000');
    }

    // Create a PENDING wallet transaction before opening Razorpay.
    const txn = await this.txnModel.create({
      userId,
      type: WalletTxnType.CREDIT,
      amount,
      description: `Wallet top-up of ₹${amount}`,
      status: WalletTxnStatus.PENDING,
      category: WalletTxnCategory.TOPUP,
      createdBy: 'USER',
    });

    // Create a Razorpay order; use wallet_<txnId> as receipt.
    const razorpayOrder = await this.paymentsService.createOrder(
      amount,
      `wallet_${txn._id}`,
    );

    txn.razorpayOrderId = razorpayOrder.id;
    await txn.save();

    return {
      walletTxnId: String(txn._id),
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,   // in paise
      currency: razorpayOrder.currency,
    };
  }

  // ── POST /wallet/add-money/verify ──────────────────────────────────────────

  async verifyAddMoney(userId: string, dto: VerifyAddMoneyDto) {
    const { walletTxnId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto;

    const txn = await this.txnModel.findById(walletTxnId);
    if (!txn || txn.userId !== userId) {
      throw new BadRequestException('Transaction not found');
    }
    if (txn.status === WalletTxnStatus.COMPLETED) {
      // Idempotent — return current balance without error.
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      return { success: true, balance: user?.walletBalance ?? 0 };
    }

    const isValid = this.paymentsService.verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );

    if (!isValid) {
      txn.status = WalletTxnStatus.FAILED;
      await txn.save();
      throw new BadRequestException('Invalid payment signature');
    }

    // Atomically claim the transaction (PENDING → COMPLETED). If a concurrent
    // verify call already claimed it, DO NOT credit again — this is the
    // replay/double-verify guard.
    const claimed = await this.txnModel.findOneAndUpdate(
      { _id: txn._id, status: WalletTxnStatus.PENDING },
      {
        $set: {
          status: WalletTxnStatus.COMPLETED,
          razorpayPaymentId,
          category: WalletTxnCategory.TOPUP,
          createdBy: 'USER',
        },
      },
      { new: true },
    );
    if (!claimed) {
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      return { success: true, balance: user?.walletBalance ?? 0 };
    }

    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: txn.amount } },
      { new: true, select: 'walletBalance' },
    );

    // Record the ledger balances on the transaction (best-effort audit fields).
    const closing = updatedUser?.walletBalance ?? txn.amount;
    await this.txnModel.updateOne(
      { _id: txn._id },
      {
        $set: {
          openingBalance: Math.round((closing - txn.amount) * 100) / 100,
          closingBalance: closing,
        },
      },
    );

    return {
      success: true,
      balance: updatedUser?.walletBalance ?? 0,
    };
  }

  // ── POST /wallet/pay-order/:orderId ────────────────────────────────────────

  async payOrderWithWallet(userId: string, orderId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order || order.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      // Idempotent — already paid, just return current balance.
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      return { success: true, alreadyPaid: true, newBalance: user?.walletBalance ?? 0 };
    }
    if (order.paymentStatus !== PaymentStatus.PENDING) {
      throw new BadRequestException('Order is not awaiting payment');
    }
    if (!order.billAmount) {
      throw new BadRequestException('Bill has not been confirmed by admin yet');
    }
    if (
      order.status !== OrderStatus.ITEMIZED &&
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException('Payment is available once your order is itemized and the bill is confirmed');
    }

    // Atomically deduct the wallet balance ONLY if it still covers the bill.
    // The $gte filter closes the check-then-act race: two concurrent pay calls
    // cannot both pass a stale balance check.
    const billAmount = order.billAmount;
    const updatedUser = await this.userModel.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: billAmount } },
      { $inc: { walletBalance: -billAmount } },
      { new: true, select: 'walletBalance' },
    );
    if (!updatedUser) {
      const user = await this.userModel.findById(userId).select('walletBalance').lean();
      const balance = user?.walletBalance ?? 0;
      throw new BadRequestException(
        `Insufficient wallet balance. Available: ₹${balance.toFixed(2)}, Required: ₹${billAmount.toFixed(2)}.`,
      );
    }

    // Atomically claim the order's payment (PENDING → COMPLETED) and generate
    // the delivery OTP — mirrors payments.controller.ts's verifyPayment
    // (Razorpay) flow, so the dispatch gate (which checks deliveryOtp) passes.
    // If a concurrent request already paid this order, refund the deduction.
    const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
    const claimedOrder = await this.orderModel.findOneAndUpdate(
      { _id: orderId, paymentStatus: PaymentStatus.PENDING },
      {
        paymentStatus: PaymentStatus.COMPLETED,
        paymentMethod: 'wallet',
        deliveryOtp,
      },
    );
    if (!claimedOrder) {
      // Lost the race — order was paid by another request. Give the money back.
      const reverted = await this.userModel.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: billAmount } },
        { new: true, select: 'walletBalance' },
      );
      return {
        success: true,
        alreadyPaid: true,
        newBalance: reverted?.walletBalance ?? 0,
      };
    }

    // Create a COMPLETED debit transaction linked to this order.
    const closing = updatedUser.walletBalance ?? 0;
    await this.txnModel.create({
      userId,
      type: WalletTxnType.DEBIT,
      amount: billAmount,
      description: `Payment for order #${order.orderNumber ?? String(order._id).slice(-6).toUpperCase()}`,
      status: WalletTxnStatus.COMPLETED,
      referenceOrderId: String(order._id),
      referenceId: String(order._id),
      category: WalletTxnCategory.PAYMENT,
      openingBalance: Math.round((closing + billAmount) * 100) / 100,
      closingBalance: closing,
      createdBy: 'USER',
    });

    // Fire payment success push notification (non-blocking)
    this.notificationsService
      .notifyPaymentSuccess(userId, order.orderNumber ?? '')
      .catch(() => { /* swallow — notification errors must not fail payment */ });

    // Admin notification bar: payment received (non-blocking)
    this.notificationsService
      .notifyAdmin({
        title: 'Payment Received 💳',
        body: `Payment confirmed for Order #${order.orderNumber ?? ''} — ₹${order.billAmount ?? 0}.`,
        type: 'payment_success',
        orderId: order.orderNumber ?? '',
      })
      .catch(() => { /* swallow */ });

    return {
      success: true,
      newBalance: updatedUser?.walletBalance ?? 0,
    };
  }
}
