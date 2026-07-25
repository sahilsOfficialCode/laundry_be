/**
 * Pure pricing calculation — no DB/network access, fully unit-testable in
 * isolation. This is the single place order totals get computed; every
 * caller (checkout, itemization, future recalculation jobs) must go through
 * this instead of computing pieces of the total inline.
 */
import { PricingUnit } from './pricing-unit.enum';

export interface PricingLineItem {
  label: string;
  amount: number;
  kind: 'auto' | 'manual';
  category?: string;
  /** Set for per-service/per-cloth-type lines (category: 'service') — omitted for fee/tax/override/round-off lines. */
  quantity?: number;
  unit?: PricingUnit | string;
  rate?: number;
}

export type DiscountSource = 'coupon' | 'first_order' | 'referral' | 'promotion' | 'loyalty';

export interface PricingDiscount {
  label: string;
  amount: number;
  source: DiscountSource;
}

export interface PricingConfigLike {
  taxRatePercent: number;
  deliveryFeeAmount: number;
  freeDeliveryThreshold: number;
  platformFeeAmount: number;
  convenienceFeeAmount: number;
  packagingFeeAmount: number;
  /** When true, rounds the pre-override total to the nearest rupee and records the diff as a "Round Off" line. Defaults to false — no charge changes unless an admin explicitly enables this. */
  roundToNearestRupee?: boolean;
}

/** One selected service or cloth-type line — the itemized unit of the bill. */
export interface PricingServiceLine {
  label: string;
  quantity: number;
  unit: PricingUnit | string;
  rate: number;
  amount: number;
}

export interface ComputeBreakdownInput {
  /** One entry per selected service (checkout) or cloth type (itemization) — never a pre-summed total. */
  serviceLines: PricingServiceLine[];
  /** Whether delivery-fee logic applies to this order at all (e.g. false for self-pickup/drop-at-shop). */
  applyDeliveryFee?: boolean;
  discounts?: PricingDiscount[];
  walletDeductionAmount?: number;
  /** When present, the engine forces payableTotal to equal this amount and records the diff as a manual line item. */
  manualOverride?: { amount: number; reason?: string };
  config: PricingConfigLike;
}

export interface PricingBreakdown {
  lineItems: PricingLineItem[];
  itemsSubtotal: number;
  taxableSubtotal: number;
  taxRatePercent: number;
  taxAmount: number;
  deliveryFee: number;
  platformFee: number;
  convenienceFee: number;
  packagingFee: number;
  discounts: PricingDiscount[];
  walletDeductionAmount: number;
  roundingAdjustment: number;
  payableTotal: number;
  isManualOverride: boolean;
  overrideReason?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeBreakdown(input: ComputeBreakdownInput): PricingBreakdown {
  const {
    serviceLines,
    applyDeliveryFee = true,
    discounts = [],
    walletDeductionAmount = 0,
    manualOverride,
    config,
  } = input;

  const itemsSubtotal = round2(serviceLines.reduce((sum, l) => sum + l.amount, 0));

  // One line item per selected service/cloth-type — never collapsed into a
  // single "Items Subtotal" figure, so the customer sees exactly what they
  // were charged for each item.
  const lineItems: PricingLineItem[] = serviceLines.map((line) => ({
    label: line.label,
    amount: round2(line.amount),
    kind: 'auto',
    category: 'service',
    quantity: line.quantity,
    unit: line.unit,
    rate: line.rate,
  }));

  const deliveryFee = applyDeliveryFee
    ? itemsSubtotal >= config.freeDeliveryThreshold
      ? 0
      : round2(config.deliveryFeeAmount)
    : 0;
  if (deliveryFee > 0) {
    lineItems.push({ label: 'Delivery Fee', amount: deliveryFee, kind: 'auto', category: 'delivery' });
  }

  const platformFee = round2(config.platformFeeAmount || 0);
  if (platformFee > 0) {
    lineItems.push({ label: 'Platform Fee', amount: platformFee, kind: 'auto', category: 'platform' });
  }

  const convenienceFee = round2(config.convenienceFeeAmount || 0);
  if (convenienceFee > 0) {
    lineItems.push({ label: 'Convenience Fee', amount: convenienceFee, kind: 'auto', category: 'convenience' });
  }

  const packagingFee = round2(config.packagingFeeAmount || 0);
  if (packagingFee > 0) {
    lineItems.push({ label: 'Packaging Fee', amount: packagingFee, kind: 'auto', category: 'packaging' });
  }

  const taxableSubtotal = round2(itemsSubtotal + deliveryFee + platformFee + convenienceFee + packagingFee);
  const taxRatePercent = config.taxRatePercent || 0;
  const taxAmount = round2((taxableSubtotal * taxRatePercent) / 100);
  if (taxAmount > 0) {
    lineItems.push({
      label: `GST @ ${taxRatePercent}%`,
      amount: taxAmount,
      kind: 'auto',
      category: 'tax',
    });
  }

  const discountsTotal = round2(discounts.reduce((sum, d) => sum + d.amount, 0));
  const walletDeduction = round2(Math.max(0, walletDeductionAmount));

  let autoTotal = Math.max(0, round2(taxableSubtotal + taxAmount - discountsTotal - walletDeduction));

  // Round Off — inactive by default (config.roundToNearestRupee undefined/false).
  // When enabled, rounds the pre-override total to the nearest rupee and
  // records the diff as its own line so the customer sees exactly what was
  // adjusted and why, rather than a total that doesn't add up.
  let roundingAdjustment = 0;
  if (config.roundToNearestRupee) {
    const rounded = Math.round(autoTotal);
    roundingAdjustment = round2(rounded - autoTotal);
    if (roundingAdjustment !== 0) {
      lineItems.push({ label: 'Round Off', amount: roundingAdjustment, kind: 'auto', category: 'rounding' });
    }
    autoTotal = rounded;
  }

  if (manualOverride) {
    const payableTotal = round2(Math.max(0, manualOverride.amount));
    const diff = round2(payableTotal - autoTotal);
    lineItems.push({
      label: 'Admin Price Adjustment',
      amount: diff,
      kind: 'manual',
      category: 'override',
    });
    return {
      lineItems,
      itemsSubtotal,
      taxableSubtotal,
      taxRatePercent,
      taxAmount,
      deliveryFee,
      platformFee,
      convenienceFee,
      packagingFee,
      discounts,
      walletDeductionAmount: walletDeduction,
      roundingAdjustment,
      payableTotal,
      isManualOverride: true,
      overrideReason: manualOverride.reason,
    };
  }

  return {
    lineItems,
    itemsSubtotal,
    taxableSubtotal,
    taxRatePercent,
    taxAmount,
    deliveryFee,
    platformFee,
    convenienceFee,
    packagingFee,
    discounts,
    walletDeductionAmount: walletDeduction,
    roundingAdjustment,
    payableTotal: autoTotal,
    isManualOverride: false,
  };
}
