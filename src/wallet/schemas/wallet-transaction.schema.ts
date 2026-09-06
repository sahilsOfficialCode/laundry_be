import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WalletTransactionDocument = WalletTransaction & Document;

export enum WalletTxnType {
  CREDIT = 'credit',
  DEBIT  = 'debit',
}

export enum WalletTxnStatus {
  PENDING   = 'pending',
  COMPLETED = 'completed',
  FAILED    = 'failed',
}

/**
 * Statuses shown in user-facing wallet views (list, recent, summary).
 * PENDING is an internal in-flight state (awaiting Razorpay callback/webhook)
 * and is deliberately excluded everywhere this is used.
 */
export const VISIBLE_WALLET_TXN_STATUSES = [
  WalletTxnStatus.COMPLETED,
  WalletTxnStatus.FAILED,
] as const;

/**
 * Business category of a wallet movement. `type` (credit/debit) says which
 * direction money moved; `category` says WHY. Optional for backward
 * compatibility — rows written before this field existed have it null.
 */
export enum WalletTxnCategory {
  REFERRAL_REWARD = 'REFERRAL_REWARD', // referral bonus credit
  ADMIN_CREDIT    = 'ADMIN_CREDIT',    // manual credit by an admin
  TOPUP           = 'TOPUP',           // Razorpay add-money
  PAYMENT         = 'PAYMENT',         // order paid from wallet
  REFUND          = 'REFUND',          // refund credited back
  DEBIT           = 'DEBIT',           // generic debit (e.g. reward clawback)
}

@Schema({ timestamps: true })
export class WalletTransaction {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ enum: WalletTxnType, required: true })
  type: WalletTxnType;

  @Prop({ required: true, min: 1 })
  amount: number;

  @Prop({ required: true })
  description: string;

  /** Razorpay order ID — set when a payment session is opened. */
  @Prop({ required: false, default: null })
  razorpayOrderId?: string;

  /** Razorpay payment ID — set after successful payment. */
  @Prop({ required: false, default: null })
  razorpayPaymentId?: string;

  /** Reference to a laundry order (for future debit-on-order flows). */
  @Prop({ required: false, default: null })
  referenceOrderId?: string;

  @Prop({ enum: WalletTxnStatus, default: WalletTxnStatus.PENDING })
  status: WalletTxnStatus;

  // ── Ledger fields (added later; null on legacy rows) ────────────────────────

  /** Business reason for the movement (see WalletTxnCategory). */
  @Prop({ type: String, enum: WalletTxnCategory, required: false, default: null, index: true })
  category?: WalletTxnCategory;

  /** User's wallet balance immediately BEFORE this transaction applied. */
  @Prop({ required: false, default: null })
  openingBalance?: number;

  /** User's wallet balance immediately AFTER this transaction applied. */
  @Prop({ required: false, default: null })
  closingBalance?: number;

  /** Who initiated it: 'SYSTEM', 'USER', 'ADMIN:<id>' etc. */
  @Prop({ required: false, default: null })
  createdBy?: string;

  /** Generic reference (referral id, refund id, ...) when not an order. */
  @Prop({ required: false, default: null, index: true })
  referenceId?: string;

  // ── Reconciliation dead-letter (mirrors Order.needsManualReview) ────────────

  /** Set once automatic repair has given up (amount mismatch, already-FAILED txn captured anyway, or no captured payment found after the lookback window) — stops the reconciliation sweep from re-checking this row forever. */
  @Prop({ required: false, default: false, index: true })
  needsManualReview?: boolean;

  @Prop({ required: false, default: null })
  needsManualReviewReason?: string;

  // Not @Prop-decorated — these already exist on every document courtesy of
  // `@Schema({ timestamps: true })` above; declaring them here just gives
  // TypeScript visibility into fields Mongoose already populates at runtime.
  createdAt?: Date;
  updatedAt?: Date;
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);

// Wallet history is always queried per-user, newest first.
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });

// User-facing list/history queries always filter to VISIBLE_WALLET_TXN_STATUSES
// on top of the per-user sort above — this compound index lets Mongo satisfy
// the equality (userId) + range (status $in) + sort (createdAt) in one pass
// instead of scanning the {userId, createdAt} index and filtering in memory.
WalletTransactionSchema.index({ userId: 1, status: 1, createdAt: -1 });
