import { computeBreakdown, PricingConfigLike } from './pricing.calculator';

const ZERO_CONFIG: PricingConfigLike = {
  taxRatePercent: 0,
  deliveryFeeAmount: 0,
  freeDeliveryThreshold: 249,
  platformFeeAmount: 0,
  convenienceFeeAmount: 0,
  packagingFeeAmount: 0,
};

const FULL_CONFIG: PricingConfigLike = {
  taxRatePercent: 18,
  deliveryFeeAmount: 49,
  freeDeliveryThreshold: 249,
  platformFeeAmount: 5,
  convenienceFeeAmount: 3,
  packagingFeeAmount: 2,
};

describe('pricing.calculator — computeBreakdown', () => {
  it('with a zeroed config, payableTotal equals itemsSubtotal exactly (no silent charge change)', () => {
    const result = computeBreakdown({ itemsSubtotal: 199, config: ZERO_CONFIG });
    expect(result.payableTotal).toBe(199);
    expect(result.taxAmount).toBe(0);
    expect(result.deliveryFee).toBe(0);
    expect(result.isManualOverride).toBe(false);
  });

  it('charges the delivery fee when subtotal is below the free-delivery threshold', () => {
    const result = computeBreakdown({ itemsSubtotal: 100, applyDeliveryFee: true, config: FULL_CONFIG });
    expect(result.deliveryFee).toBe(49);
  });

  it('waives the delivery fee at/above the free-delivery threshold (boundary)', () => {
    const atThreshold = computeBreakdown({ itemsSubtotal: 249, applyDeliveryFee: true, config: FULL_CONFIG });
    expect(atThreshold.deliveryFee).toBe(0);

    const justBelow = computeBreakdown({ itemsSubtotal: 248.99, applyDeliveryFee: true, config: FULL_CONFIG });
    expect(justBelow.deliveryFee).toBe(49);
  });

  it('never applies delivery fee when applyDeliveryFee is false, regardless of subtotal', () => {
    const result = computeBreakdown({ itemsSubtotal: 10, applyDeliveryFee: false, config: FULL_CONFIG });
    expect(result.deliveryFee).toBe(0);
  });

  it('computes tax on the taxable subtotal (items + delivery + platform + convenience + packaging fees)', () => {
    const result = computeBreakdown({ itemsSubtotal: 100, applyDeliveryFee: true, config: FULL_CONFIG });
    // taxable = 100 + 49 (delivery) + 5 (platform) + 3 (convenience) + 2 (packaging) = 159
    expect(result.taxableSubtotal).toBe(159);
    expect(result.taxAmount).toBe(28.62); // 18% of 159
  });

  it('subtracts discounts and wallet deduction from the payable total', () => {
    const result = computeBreakdown({
      itemsSubtotal: 500,
      config: ZERO_CONFIG,
      discounts: [{ label: 'Coupon', amount: 100, source: 'coupon' }],
      walletDeductionAmount: 50,
    });
    expect(result.payableTotal).toBe(350);
  });

  it('never lets the payable total go negative when discounts exceed the subtotal', () => {
    const result = computeBreakdown({
      itemsSubtotal: 50,
      config: ZERO_CONFIG,
      discounts: [{ label: 'Coupon', amount: 100, source: 'coupon' }],
    });
    expect(result.payableTotal).toBe(0);
  });

  it('a manual override forces payableTotal to equal the override amount exactly, recording the diff as a manual line item', () => {
    const result = computeBreakdown({
      itemsSubtotal: 500,
      config: ZERO_CONFIG,
      manualOverride: { amount: 600, reason: 'Extra stains, re-wash required' },
    });
    expect(result.payableTotal).toBe(600);
    expect(result.isManualOverride).toBe(true);
    expect(result.overrideReason).toBe('Extra stains, re-wash required');

    const overrideLine = result.lineItems.find((l) => l.label === 'Admin Price Adjustment');
    expect(overrideLine).toBeDefined();
    expect(overrideLine!.amount).toBe(100); // 600 - 500
    expect(overrideLine!.kind).toBe('manual');

    // Every auto line item still reflects the real calculation, not the override.
    const itemsLine = result.lineItems.find((l) => l.label === 'Items Subtotal');
    expect(itemsLine!.amount).toBe(500);
    expect(itemsLine!.kind).toBe('auto');
  });

  it('a manual override below the calculated amount records a negative diff', () => {
    const result = computeBreakdown({
      itemsSubtotal: 500,
      config: ZERO_CONFIG,
      manualOverride: { amount: 400 },
    });
    expect(result.payableTotal).toBe(400);
    const overrideLine = result.lineItems.find((l) => l.label === 'Admin Price Adjustment');
    expect(overrideLine!.amount).toBe(-100);
  });

  it('does not emit fee line items for zero-value fees', () => {
    const result = computeBreakdown({ itemsSubtotal: 500, config: ZERO_CONFIG });
    expect(result.lineItems).toHaveLength(1); // only 'Items Subtotal'
  });
});
