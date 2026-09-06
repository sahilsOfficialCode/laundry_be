import { computeBreakdown, PricingConfigLike, PricingServiceLine } from './pricing.calculator';
import { PricingUnit } from './pricing-unit.enum';

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

function line(overrides: Partial<PricingServiceLine> = {}): PricingServiceLine {
  return { label: 'Wash & Fold', quantity: 1, unit: PricingUnit.KG, rate: 199, amount: 199, ...overrides };
}

describe('pricing.calculator — computeBreakdown', () => {
  it('with a zeroed config, payableTotal equals the sum of service lines exactly (no silent charge change)', () => {
    const result = computeBreakdown({ serviceLines: [line({ amount: 199 })], config: ZERO_CONFIG });
    expect(result.itemsSubtotal).toBe(199);
    expect(result.payableTotal).toBe(199);
    expect(result.taxAmount).toBe(0);
    expect(result.deliveryFee).toBe(0);
    expect(result.isManualOverride).toBe(false);
  });

  it('emits one line item per service line, preserving quantity/unit/rate', () => {
    const result = computeBreakdown({
      serviceLines: [
        line({ label: 'Wash & Fold', quantity: 2, unit: PricingUnit.KG, rate: 100, amount: 200 }),
        line({ label: 'Shirt', quantity: 3, unit: PricingUnit.PIECE, rate: 20, amount: 60 }),
      ],
      config: ZERO_CONFIG,
    });
    const serviceLines = result.lineItems.filter((l) => l.category === 'service');
    expect(serviceLines).toHaveLength(2);
    expect(serviceLines[0]).toMatchObject({ label: 'Wash & Fold', quantity: 2, unit: PricingUnit.KG, rate: 100, amount: 200 });
    expect(serviceLines[1]).toMatchObject({ label: 'Shirt', quantity: 3, unit: PricingUnit.PIECE, rate: 20, amount: 60 });
    expect(result.itemsSubtotal).toBe(260);
  });

  it('charges the delivery fee when subtotal is below the free-delivery threshold', () => {
    const result = computeBreakdown({ serviceLines: [line({ amount: 100 })], applyDeliveryFee: true, config: FULL_CONFIG });
    expect(result.deliveryFee).toBe(49);
  });

  it('waives the delivery fee at/above the free-delivery threshold (boundary)', () => {
    const atThreshold = computeBreakdown({ serviceLines: [line({ amount: 249 })], applyDeliveryFee: true, config: FULL_CONFIG });
    expect(atThreshold.deliveryFee).toBe(0);

    const justBelow = computeBreakdown({ serviceLines: [line({ amount: 248.99 })], applyDeliveryFee: true, config: FULL_CONFIG });
    expect(justBelow.deliveryFee).toBe(49);
  });

  it('never applies delivery fee when applyDeliveryFee is false, regardless of subtotal', () => {
    const result = computeBreakdown({ serviceLines: [line({ amount: 10 })], applyDeliveryFee: false, config: FULL_CONFIG });
    expect(result.deliveryFee).toBe(0);
  });

  it('computes tax on the taxable subtotal (items + delivery + platform + convenience + packaging fees)', () => {
    const result = computeBreakdown({ serviceLines: [line({ amount: 100 })], applyDeliveryFee: true, config: FULL_CONFIG });
    // taxable = 100 + 49 (delivery) + 5 (platform) + 3 (convenience) + 2 (packaging) = 159
    expect(result.taxableSubtotal).toBe(159);
    expect(result.taxAmount).toBe(28.62); // 18% of 159
  });

  it('subtracts discounts and wallet deduction from the payable total', () => {
    const result = computeBreakdown({
      serviceLines: [line({ amount: 500 })],
      config: ZERO_CONFIG,
      discounts: [{ label: 'Coupon', amount: 100, source: 'coupon' }],
      walletDeductionAmount: 50,
    });
    expect(result.payableTotal).toBe(350);
  });

  it('never lets the payable total go negative when discounts exceed the subtotal', () => {
    const result = computeBreakdown({
      serviceLines: [line({ amount: 50 })],
      config: ZERO_CONFIG,
      discounts: [{ label: 'Coupon', amount: 100, source: 'coupon' }],
    });
    expect(result.payableTotal).toBe(0);
  });

  it('a manual override forces payableTotal to equal the override amount exactly, recording the diff as a manual line item', () => {
    const result = computeBreakdown({
      serviceLines: [line({ amount: 500 })],
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

    // The service line still reflects the real calculation, not the override.
    const serviceLine = result.lineItems.find((l) => l.category === 'service');
    expect(serviceLine!.amount).toBe(500);
    expect(serviceLine!.kind).toBe('auto');
  });

  it('a manual override below the calculated amount records a negative diff', () => {
    const result = computeBreakdown({
      serviceLines: [line({ amount: 500 })],
      config: ZERO_CONFIG,
      manualOverride: { amount: 400 },
    });
    expect(result.payableTotal).toBe(400);
    const overrideLine = result.lineItems.find((l) => l.label === 'Admin Price Adjustment');
    expect(overrideLine!.amount).toBe(-100);
  });

  it('does not emit fee line items for zero-value fees', () => {
    const result = computeBreakdown({ serviceLines: [line({ amount: 500 })], config: ZERO_CONFIG });
    expect(result.lineItems).toHaveLength(1); // only the one service line
  });

  describe('rounding (roundToNearestRupee)', () => {
    it('defaults to off — roundingAdjustment is always 0 and no Round Off line appears', () => {
      const result = computeBreakdown({ serviceLines: [line({ amount: 100.4 })], config: ZERO_CONFIG });
      expect(result.roundingAdjustment).toBe(0);
      expect(result.payableTotal).toBe(100.4);
      expect(result.lineItems.find((l) => l.label === 'Round Off')).toBeUndefined();
    });

    it('when enabled, rounds the total to the nearest rupee and records the diff', () => {
      const result = computeBreakdown({
        serviceLines: [line({ amount: 100.4 })],
        config: { ...ZERO_CONFIG, roundToNearestRupee: true },
      });
      expect(result.payableTotal).toBe(100);
      expect(result.roundingAdjustment).toBe(-0.4);
      const roundOffLine = result.lineItems.find((l) => l.label === 'Round Off');
      expect(roundOffLine).toBeDefined();
      expect(roundOffLine!.amount).toBe(-0.4);
    });

    it('a manual override still wins over rounding — payableTotal equals the override exactly', () => {
      const result = computeBreakdown({
        serviceLines: [line({ amount: 100.4 })],
        config: { ...ZERO_CONFIG, roundToNearestRupee: true },
        manualOverride: { amount: 150 },
      });
      expect(result.payableTotal).toBe(150);
    });
  });
});
