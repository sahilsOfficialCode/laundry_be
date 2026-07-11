/**
 * Shared enums for the Refer & Earn module.
 * Kept in one place so schemas, DTOs, services and the frontend contract
 * all reference a single source of truth.
 */

/**
 * Lifecycle of a single referral (referrer → referee relationship).
 *
 * PENDING → REGISTERED → FIRST_ORDER_COMPLETED → PAYMENT_COMPLETED → REWARD_RELEASED
 * Any state can transition to EXPIRED (via background job) or REJECTED (fraud/admin).
 */
export enum ReferralStatus {
  PENDING = 'PENDING', // code applied, referee account created but not yet qualified
  REGISTERED = 'REGISTERED', // referee successfully registered
  FIRST_ORDER_COMPLETED = 'FIRST_ORDER_COMPLETED', // referee placed & completed first order
  PAYMENT_COMPLETED = 'PAYMENT_COMPLETED', // payment for the first order settled
  REWARD_RELEASED = 'REWARD_RELEASED', // reward credited to referrer wallet
  EXPIRED = 'EXPIRED', // referral window passed before qualifying
  REJECTED = 'REJECTED', // rejected by fraud engine or admin
}

/** Reward payout mechanisms an admin can configure. */
export enum RewardType {
  FIXED_AMOUNT = 'FIXED_AMOUNT', // flat INR amount
  PERCENTAGE = 'PERCENTAGE', // % of the referee's first order value
  WALLET_CREDIT = 'WALLET_CREDIT', // credited to wallet (default mechanism)
  COUPON = 'COUPON', // issue a coupon code
  POINTS = 'POINTS', // loyalty points
  FREE_DELIVERY = 'FREE_DELIVERY', // free-delivery perk
}

/** Reward record lifecycle. */
export enum RewardStatus {
  PENDING = 'PENDING', // milestone not yet reached
  RELEASED = 'RELEASED', // credited to wallet
  REVERSED = 'REVERSED', // clawed back (refund / fraud after release)
  EXPIRED = 'EXPIRED', // never released within the window
  REJECTED = 'REJECTED', // denied by fraud/admin
}

/** Who the reward belongs to. */
export enum RewardBeneficiary {
  REFERRER = 'REFERRER', // the existing user who shared the code
  REFEREE = 'REFEREE', // the newly-joined friend
}

/** Reasons a referral can be auto-rejected by the fraud engine. */
export enum FraudReason {
  SAME_DEVICE = 'SAME_DEVICE',
  SAME_IP = 'SAME_IP',
  SAME_PHONE = 'SAME_PHONE',
  SAME_EMAIL = 'SAME_EMAIL',
  SELF_REFERRAL = 'SELF_REFERRAL',
  EMULATOR = 'EMULATOR',
  FAKE_GPS = 'FAKE_GPS',
  VPN = 'VPN',
  MULTIPLE_ACCOUNTS = 'MULTIPLE_ACCOUNTS',
  VELOCITY_LIMIT = 'VELOCITY_LIMIT', // too many referrals in a short window
  SUSPICIOUS = 'SUSPICIOUS',
}

/** Audit-log action types written to referral_logs. */
export enum ReferralLogAction {
  CODE_GENERATED = 'CODE_GENERATED',
  VALIDATED = 'VALIDATED',
  APPLIED = 'APPLIED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  REWARD_RELEASED = 'REWARD_RELEASED',
  REWARD_REVERSED = 'REWARD_REVERSED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',
  FRAUD_FLAGGED = 'FRAUD_FLAGGED',
}

/**
 * Wallet transaction subtype used for referral bonuses. The existing wallet
 * schema only has CREDIT/DEBIT; referral entries are CREDIT with this reason
 * so they can be filtered/reported separately without touching wallet code.
 */
export enum ReferralWalletReason {
  REFERRAL_BONUS = 'REFERRAL_BONUS',
  REFERRAL_REVERSED = 'REFERRAL_REVERSED',
  REFERRAL_EXPIRED = 'REFERRAL_EXPIRED',
}
