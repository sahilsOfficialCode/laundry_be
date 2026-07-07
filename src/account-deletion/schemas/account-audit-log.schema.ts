import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AuditAction } from '../enums/account-deletion.enums';

export type AccountAuditLogDocument = AccountAuditLog & Document;

/**
 * Append-only audit trail for account-deletion events. Powers the admin
 * "delete timeline" and satisfies the audit-logging security requirement.
 */
@Schema({ timestamps: true })
export class AccountAuditLog {
  @Prop({ required: false, default: null, index: true })
  deleteRequestId?: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: String, enum: AuditAction, required: true, index: true })
  action: AuditAction;

  /** Actor: 'USER', 'SYSTEM', or 'ADMIN:<id>'. */
  @Prop({ required: true, default: 'SYSTEM' })
  actor: string;

  @Prop({ required: false, default: null })
  message?: string;

  /** Request context (ip, userAgent) — never store personal data here. */
  @Prop({ required: false, default: null })
  ipAddress?: string;

  @Prop({ type: Object, required: false, default: {} })
  meta?: Record<string, any>;
}

export const AccountAuditLogSchema =
  SchemaFactory.createForClass(AccountAuditLog);

AccountAuditLogSchema.index({ deleteRequestId: 1, createdAt: 1 });
