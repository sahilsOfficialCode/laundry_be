/**
 * Pure pricing calculation — no DB/network access, fully unit-testable in
 * isolation. This is the single place order totals get computed; every
 * caller (checkout, itemization, future recalculation jobs) must go through
 * this instead of computing pieces of the total inline.
 */

export interface PricingLineItem {
  label: string;
  amount: number;
  kind: 'auto' | 'manual';
  category?: string;
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
}

export interface ComputeBreakdownInput {
  /** Sum of item price*quantity (checkout) or cloth-type breakdown amounts (itemization). */
  itemsSubtotal: number;
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
  taxableSubtotal: number;
  taxRatePercent: number;
  taxAmount: number;
  deliveryFee: number;
  platformFee: number;
  convenienceFee: number;
  packagingFee: number;
  discounts: PricingDiscount[];
  walletDeductionAmount: number;
  payableTotal: number;
  isManualOverride: boolean;
  overrideReason?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeBreakdown(input: ComputeBreakdownInput): PricingBreakdown {
  const {
    itemsSubtotal,
    applyDeliveryFee = true,
    discounts = [],
    walletDeductionAmount = 0,
    manualOverride,
    config,
  } = input;

  const lineItems: PricingLineItem[] = [
    { label: 'Items Subtotal', amount: round2(itemsSubtotal), kind: 'auto', category: 'items' },
  ];

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

  const autoTotal = Math.max(0, round2(taxableSubtotal + taxAmount - discountsTotal - walletDeduction));

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
      taxableSubtotal,
      taxRatePercent,
      taxAmount,
      deliveryFee,
      platformFee,
      convenienceFee,
      packagingFee,
      discounts,
      walletDeductionAmount: walletDeduction,
      payableTotal,
      isManualOverride: true,
      overrideReason: manualOverride.reason,
    };
  }

  return {
    lineItems,
    taxableSubtotal,
    taxRatePercent,
    taxAmount,
    deliveryFee,
    platformFee,
    convenienceFee,
    packagingFee,
    discounts,
    walletDeductionAmount: walletDeduction,
    payableTotal: autoTotal,
    isManualOverride: false,
  };
}
