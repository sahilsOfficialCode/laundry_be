import { buildBillingSummary, BillableOrderLike } from './billing-summary.util';

describe('buildBillingSummary', () => {
  it('builds SERVICE rows from items[] with SUBTOTAL === TOTAL when there are no discounts/wallet', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 5, price: 50, unit: 'kg' }],
      totalAmount: 250,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems).toEqual([
      { type: 'SERVICE', label: 'Wash & Fold', amount: 250, quantity: 5, unit: 'kg', serviceId: 's1', unitPrice: 50 },
      { type: 'SUBTOTAL', label: 'Subtotal', amount: 250 },
      { type: 'TOTAL', label: 'Total', amount: 250 },
    ]);
  });

  it('prefers clothTypeBreakdown over items[] when both are present, hardcoding unit to pcs and omitting serviceId', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 5, price: 50, unit: 'kg' }],
      clothTypeBreakdown: [
        { clothTypeId: 'c1', clothTypeName: 'Shirt', quantity: 3, rate: 20, amount: 60 },
        { clothTypeId: 'c2', clothTypeName: 'Trouser', quantity: 2, rate: 25, amount: 50 },
      ],
      totalAmount: 250,
      billAmount: 110,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems).toEqual([
      { type: 'SERVICE', label: 'Shirt', amount: 60, quantity: 3, unit: 'pcs', unitPrice: 20 },
      { type: 'SERVICE', label: 'Trouser', amount: 50, quantity: 2, unit: 'pcs', unitPrice: 25 },
      { type: 'SUBTOTAL', label: 'Subtotal', amount: 110 },
      { type: 'TOTAL', label: 'Total', amount: 110 },
    ]);
  });

  it('adds a negative DISCOUNT row labeled with the coupon code when couponDiscountAmount > 0', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 2, price: 100, unit: 'kg' }],
      totalAmount: 150,
      couponCode: 'SAVE50',
      couponDiscountAmount: 50,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems).toContainEqual({ type: 'DISCOUNT', label: 'Coupon (SAVE50)', amount: -50 });
    expect(lineItems[lineItems.length - 1]).toEqual({ type: 'TOTAL', label: 'Total', amount: 150 });
  });

  it('adds a negative DISCOUNT row for firstOrderDiscountAmount', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 200 }],
      totalAmount: 180,
      firstOrderDiscountAmount: 20,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems).toContainEqual({ type: 'DISCOUNT', label: 'First Order Discount', amount: -20 });
  });

  it('stacks coupon and first-order discounts as two separate rows', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 300 }],
      totalAmount: 250,
      billAmount: 250,
      couponCode: 'WELCOME10',
      couponDiscountAmount: 30,
      firstOrderDiscountAmount: 20,
    };

    const { lineItems } = buildBillingSummary(order);
    const discountRows = lineItems.filter((l) => l.type === 'DISCOUNT');

    expect(discountRows).toEqual([
      { type: 'DISCOUNT', label: 'Coupon (WELCOME10)', amount: -30 },
      { type: 'DISCOUNT', label: 'First Order Discount', amount: -20 },
    ]);
    expect(lineItems[lineItems.length - 1]).toEqual({ type: 'TOTAL', label: 'Total', amount: 250 });
  });

  it('appends a WALLET row equal to walletDebitAmount when supplied and positive', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 300 }],
      totalAmount: 300,
      billAmount: 300,
    };

    const { lineItems } = buildBillingSummary(order, 300);

    expect(lineItems).toContainEqual({ type: 'WALLET', label: 'Paid via Wallet', amount: 300 });
  });

  it('omits the WALLET row when walletDebitAmount is undefined or zero', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 300 }],
      totalAmount: 300,
    };

    expect(buildBillingSummary(order).lineItems.some((l) => l.type === 'WALLET')).toBe(false);
    expect(buildBillingSummary(order, 0).lineItems.some((l) => l.type === 'WALLET')).toBe(false);
  });

  it('handles a free / 100%-off order: TOTAL is 0, not negative or NaN', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 199 }],
      totalAmount: 0,
      billAmount: 0,
      couponCode: 'FREE100',
      couponDiscountAmount: 199,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems[lineItems.length - 1]).toEqual({ type: 'TOTAL', label: 'Total', amount: 0 });
  });

  it('handles multiple items[] rows, summing correctly into SUBTOTAL', () => {
    const order: BillableOrderLike = {
      items: [
        { serviceId: 's1', serviceName: 'Wash & Fold', quantity: 5, price: 50, unit: 'kg' },
        { serviceId: 's2', serviceName: 'Steam Iron', quantity: 10, price: 15, unit: 'pcs' },
        { serviceId: 's3', serviceName: 'Shoe Cleaning', quantity: 1, price: 299, unit: 'pair' },
      ],
      totalAmount: 699,
    };

    const { lineItems } = buildBillingSummary(order);
    const serviceRows = lineItems.filter((l) => l.type === 'SERVICE');
    const subtotal = lineItems.find((l) => l.type === 'SUBTOTAL');

    expect(serviceRows).toHaveLength(3);
    expect(subtotal).toEqual({ type: 'SUBTOTAL', label: 'Subtotal', amount: 699 });
  });

  it('falls back to bare quantity (no unit) when item.unit is missing (legacy order)', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 5, price: 50 }],
      totalAmount: 250,
    };

    const { lineItems } = buildBillingSummary(order);
    const serviceRow = lineItems.find((l) => l.type === 'SERVICE');

    expect(serviceRow?.unit).toBeUndefined();
    expect(serviceRow?.quantity).toBe(5);
  });

  it('returns just SUBTOTAL(0) + TOTAL(totalAmount) without throwing when items/clothTypeBreakdown are both empty', () => {
    const order: BillableOrderLike = { items: [], clothTypeBreakdown: [], totalAmount: 0 };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems).toEqual([
      { type: 'SUBTOTAL', label: 'Subtotal', amount: 0 },
      { type: 'TOTAL', label: 'Total', amount: 0 },
    ]);
  });

  it('uses billAmount over totalAmount for TOTAL when both are present', () => {
    const order: BillableOrderLike = {
      items: [{ serviceId: 's1', serviceName: 'Wash & Fold', quantity: 1, price: 100 }],
      totalAmount: 100,
      billAmount: 85,
    };

    const { lineItems } = buildBillingSummary(order);

    expect(lineItems[lineItems.length - 1]).toEqual({ type: 'TOTAL', label: 'Total', amount: 85 });
  });
});
