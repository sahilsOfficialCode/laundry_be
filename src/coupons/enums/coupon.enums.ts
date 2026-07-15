/** Discount mechanics — matches the spec's "Fixed Amount / Percentage" toggle. */
export enum CouponDiscountType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

/** Admin-controlled lifecycle. "Expired" is derived from expiryDate, never stored. */
export enum CouponStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/** Effective status shown to admins/customers — combines `status` with expiry. */
export enum CouponEffectiveStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  DISABLED = 'disabled',
}

/** Per-user assignment lifecycle. Removed assignments are kept (not deleted) for audit history. */
export enum CouponAssignmentStatus {
  ACTIVE = 'active',
  REMOVED = 'removed',
}

/** How a user came to be assigned to a coupon — powers the "Assigned Users" audit trail. */
export enum CouponAssignmentSource {
  MANUAL = 'manual',
  BULK_CONDITION = 'bulk_condition',
}

/** Bulk-assignment conditions the admin can pick from — see coupon-conditions.service.ts. */
export enum CouponBulkCondition {
  MISSED_FIRST_CASHBACK = 'missed_first_cashback',
  FAILED_PAYMENT = 'failed_payment',
  COMPLETED_FIRST_ORDER = 'completed_first_order',
  NO_ORDERS_30_DAYS = 'no_orders_30_days',
  WALLET_BALANCE_BELOW_100 = 'wallet_balance_below_100',
  CITY = 'city',
  CUSTOM_USER_IDS = 'custom_user_ids',
}

/** Append-only audit trail action types (admin actions on coupons). */
export enum CouponAuditAction {
  COUPON_CREATED = 'coupon_created',
  COUPON_UPDATED = 'coupon_updated',
  COUPON_DISABLED = 'coupon_disabled',
  COUPON_ENABLED = 'coupon_enabled',
  COUPON_DELETED = 'coupon_deleted',
  USERS_ASSIGNED = 'users_assigned',
  USER_REMOVED = 'user_removed',
  USER_REASSIGNED = 'user_reassigned',
  COUPON_REDEEMED = 'coupon_redeemed',
}
