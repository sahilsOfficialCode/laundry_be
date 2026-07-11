import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReferralRateLimitDocument = ReferralRateLimit & Document;

/**
 * Fixed-window rate-limit counter, persisted in MongoDB so limits survive
 * restarts and hold across multiple app instances (no Redis required).
 * One row per (identity, route, window); a TTL index removes expired windows.
 */
@Schema()
export class ReferralRateLimit {
  /** `<userId|ip>:<Controller.handler>:<windowId>` */
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  count: number;

  /** Window end (plus slack); the TTL monitor deletes the row after this. */
  @Prop({ required: true })
  expiresAt: Date;
}

export const ReferralRateLimitSchema =
  SchemaFactory.createForClass(ReferralRateLimit);

// TTL cleanup — Mongo removes the row once expiresAt passes.
ReferralRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
