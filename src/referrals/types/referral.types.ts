import { ReferralStatus } from '../enums/referral.enums';

/**
 * Shared response/DTO-shaped types (not persisted). Keeping the API contract
 * types here means the controllers, services and the frontend can agree on
 * one shape.
 */

/** Anti-abuse signals collected from request headers/body at apply time. */
export interface ReferralContext {
  deviceId?: string;
  ipAddress?: string;
  isEmulator?: boolean;
  isFakeGps?: boolean;
  isVpn?: boolean;
  phone?: string;
  email?: string;
}

/** One row in a user's referral history. */
export interface ReferralHistoryItem {
  referralId: string;
  refereeName: string;
  joinedDate: Date | null;
  status: ReferralStatus;
  rewardAmount: number;
  rewardStatus: string;
  releasedDate: Date | null;
  pendingReward: number;
  rejectedReason: string | null;
}

/** Admin dashboard summary cards. */
export interface ReferralDashboardSummary {
  totalReferrals: number;
  pendingReferrals: number;
  completedReferrals: number;
  rejectedReferrals: number;
  rewardPaid: number;
  rewardPending: number;
  mostActiveReferrers: Array<{ referrerId: string; name: string; count: number }>;
  topCities: Array<{ city: string; count: number }>;
}

/** Generic paginated envelope used by list endpoints. */
export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
