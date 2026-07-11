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
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);

// Wallet history is always queried per-user, newest first.
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
