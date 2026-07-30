import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PricingConfigDocument = PricingConfig & Document;

/**
 * Singleton configuration document controlling the pricing engine's fees/tax.
 * A single row is seeded on first read (see PricingConfigService), mirroring
 * ReferralSettings. Defaults match the values previously hardcoded in the
 * Flutter checkout screen so behavior doesn't change when this rolls out.
 */
@Schema({ timestamps: true })
export class PricingConfig {
  /** Stable key so we can upsert the one-and-only settings row. */
  @Prop({ required: true, unique: true, default: 'GLOBAL' })
  key: string;

  /**
   * Single-rate GST percentage applied to the taxable subtotal. Defaults to
   * 0 (no charge change on rollout) — the engine is fully wired to charge
   * real GST the moment an admin raises this via a future settings screen,
   * but Phase 1 deliberately ships with pricing transparency/audit trail
   * only, not a change to what customers are actually billed.
   */
  @Prop({ default: 0, min: 0, max: 100 })
  taxRatePercent: number;

  /**
   * Flat delivery fee charged when the order subtotal is below
   * freeDeliveryThreshold. Defaults to 0 for the same reason as
   * taxRatePercent above — ready to enable, not enabled yet.
   */
  @Prop({ default: 0, min: 0 })
  deliveryFeeAmount: number;

  /** Order subtotal at/above which delivery is free. */
  @Prop({ default: 249, min: 0 })
  freeDeliveryThreshold: number;

  /** Flat platform fee applied to every order. 0 disables it. */
  @Prop({ default: 0, min: 0 })
  platformFeeAmount: number;

  /** Flat payment-convenience fee applied to every order. 0 disables it. */
  @Prop({ default: 0, min: 0 })
  convenienceFeeAmount: number;

  /** Flat packaging fee applied to every order. 0 disables it. */
  @Prop({ default: 0, min: 0 })
  packagingFeeAmount: number;

  /**
   * When true, rounds each order's pre-override total to the nearest rupee
   * and shows the diff as a "Round Off" line. Defaults to false — ready to
   * enable, not enabled yet, so no customer's charge changes on rollout.
   */
  @Prop({ default: false })
  roundToNearestRupee: boolean;

  /**
   * Soft guard only: an admin override beyond this percentage difference from
   * the calculated amount doesn't get blocked, but flags the order for
   * manual review (needsManualReview) so it doesn't ship unnoticed.
   */
  @Prop({ default: 30, min: 0 })
  maxOverridePercent: number;
}

export const PricingConfigSchema = SchemaFactory.createForClass(PricingConfig);
