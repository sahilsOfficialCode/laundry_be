import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  DeleteReason,
  DeleteRequestStatus,
  VerificationMethod,
} from '../enums/account-deletion.enums';

export type DeleteRequestDocument = DeleteRequest & Document;

/**
 * One account-deletion request. There is at most one active (non-terminal)
 * request per user at a time (enforced in the service).
 */
@Schema({ timestamps: true })
export class DeleteRequest {
  @Prop({ required: true, index: true })
  userId: string;

  /** Snapshot of identifiers at request time (for admin search after anonymise). */
  @Prop({ required: false, default: null })
  userEmail?: string;
  @Prop({ required: false, default: null })
  userMobile?: string;
  @Prop({ required: false, default: null })
  userName?: string;

  @Prop({ type: String, enum: DeleteReason, required: true })
  reason: DeleteReason;

  @Prop({ required: false, default: null })
  comment?: string;

  @Prop({
    type: String,
    enum: DeleteRequestStatus,
    default: DeleteRequestStatus.PENDING_VERIFICATION,
    index: true,
  })
  status: DeleteRequestStatus;

  // ── Identity verification ──────────────────────────────────────────────────
  @Prop({ type: String, enum: VerificationMethod, required: false, default: null })
  verificationMethod?: VerificationMethod;

  @Prop({ required: false, default: null })
  verifiedAt?: Date;

  /**
   * Short-lived, single-use token issued after successful identity
   * verification. Required in POST /account/delete/confirm.
   */
  @Prop({ type: String, required: false, default: null })
  verificationToken?: string | null;

  @Prop({ type: Date, required: false, default: null })
  verificationTokenExpiresAt?: Date | null;

  // ── Processing timestamps ──────────────────────────────────────────────────
  @Prop({ required: false, default: null })
  confirmedAt?: Date;

  /** When the personal data must be purged/anonymised (confirmedAt + retention). */
  @Prop({ required: false, default: null, index: true })
  retentionUntil?: Date;

  @Prop({ required: false, default: null })
  cleanedAt?: Date;

  // ── Admin action (reject/restore) ──────────────────────────────────────────
  @Prop({ required: false, default: null })
  adminId?: string;
  @Prop({ required: false, default: null })
  rejectionReason?: string;
  @Prop({ required: false, default: null })
  processedAt?: Date;
}

export const DeleteRequestSchema = SchemaFactory.createForClass(DeleteRequest);

// Common admin queries.
DeleteRequestSchema.index({ status: 1, createdAt: -1 });
DeleteRequestSchema.index({ status: 1, retentionUntil: 1 }); // cleanup job
