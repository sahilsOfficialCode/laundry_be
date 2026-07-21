export type BillingLineItemType =
  | 'SERVICE'
  | 'SUBTOTAL'
  | 'DISCOUNT'
  | 'WALLET'
  | 'DELIVERY'
  | 'TAX'
  | 'ROUND_OFF'
  | 'TOTAL';

export interface BillingLineItem {
  type: BillingLineItemType;
  label: string;
  amount: number;
  quantity?: number;
  unit?: string;
  serviceId?: string;
  unitPrice?: number;
}

export interface BillingSummary {
  lineItems: BillingLineItem[];
}

/** Structural subset of Order needed to build a billing summary — kept loose
 *  (not Order/OrderDocument) so this stays a pure, DB-agnostic function. */
export interface BillableOrderLike {
  items?: {
    serviceId: string;
    serviceName: string;
    quantity: number;
    price: number;
    unit?: string;
  }[];
  clothTypeBreakdown?: {
    clothTypeId: string;
    clothTypeName: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  totalAmount: number;
  billAmount?: number;
  couponCode?: string;
  couponDiscountAmount?: number;
  firstOrderDiscountAmount?: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Builds the ordered, typed billing line items for an order.
 *
 * Source-of-truth rule for SERVICE rows: clothTypeBreakdown (post-itemization,
 * admin-entered actuals) wins when present; otherwise items[] (pre-itemization
 * cart estimate) is used. These are never merged.
 *
 * DELIVERY/TAX/ROUND_OFF are intentionally omitted — no backing field exists
 * on Order today, and a fabricated ₹0 row would assert a fact ("delivery is
 * known and free") the backend doesn't actually know. The day a real field
 * (e.g. deliveryCharge) is added to the schema, add it here and it appears in
 * both apps with zero Flutter/admin changes.
 *
 * walletDebitAmount: pass the amount of a COMPLETED WalletTxnCategory.PAYMENT
 * transaction for this order, if one exists (caller looks it up — this stays
 * a pure function). Wallet payment in this codebase is all-or-nothing, so
 * when present this always equals the TOTAL row's amount.
 */
export function buildBillingSummary(
  order: BillableOrderLike,
  walletDebitAmount?: number,
): BillingSummary {
  const lineItems: BillingLineItem[] = [];
  const useBreakdown = Array.isArray(order.clothTypeBreakdown) && order.clothTypeBreakdown.length > 0;

  let subtotal = 0;

  if (useBreakdown) {
    for (const row of order.clothTypeBreakdown!) {
      lineItems.push({
        type: 'SERVICE',
        label: row.clothTypeName,
        amount: round2(row.amount),
        quantity: row.quantity,
        unit: 'pcs', // ClothType has no weight concept — always per-garment
        unitPrice: row.rate,
        // serviceId intentionally omitted: clothTypeBreakdown rows key off
        // ClothType, not LaundryService — no FK exists between them today.
      });
      subtotal += row.amount;
    }
  } else {
    for (const item of order.items ?? []) {
      const amount = round2(item.price * item.quantity);
      lineItems.push({
        type: 'SERVICE',
        label: item.serviceName,
        amount,
        quantity: item.quantity,
        unit: item.unit || undefined, // absent on legacy items — FE falls back to bare quantity
        serviceId: item.serviceId,
        unitPrice: item.price,
      });
      subtotal += amount;
    }
  }

  subtotal = round2(subtotal);
  lineItems.push({ type: 'SUBTOTAL', label: 'Subtotal', amount: subtotal });

  if (order.couponDiscountAmount && order.couponDiscountAmount > 0) {
    lineItems.push({
      type: 'DISCOUNT',
      label: order.couponCode ? `Coupon (${order.couponCode})` : 'Coupon Discount',
      amount: -round2(order.couponDiscountAmount),
    });
  }

  if (order.firstOrderDiscountAmount && order.firstOrderDiscountAmount > 0) {
    lineItems.push({
      type: 'DISCOUNT',
      label: 'First Order Discount',
      amount: -round2(order.firstOrderDiscountAmount),
    });
  }

  if (walletDebitAmount && walletDebitAmount > 0) {
    lineItems.push({ type: 'WALLET', label: 'Paid via Wallet', amount: round2(walletDebitAmount) });
  }

  const total = order.billAmount ?? order.totalAmount ?? 0;
  lineItems.push({ type: 'TOTAL', label: 'Total', amount: round2(total) });

  return { lineItems };
}
