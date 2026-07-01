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
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);
