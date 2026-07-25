/**
 * Availability check itself now lives in ServiceAvailabilityService
 * (src/service-availability) — DB-backed, admin-editable, replaces the old
 * env-var-only INSTANT_ORDER_CUTOFF_TIME cutoff. This file just keeps the
 * user-facing messages so callers don't need to duplicate copy.
 */
export const INSTANT_ORDER_UNAVAILABLE_MESSAGE = 'Instant not available';
export const SCHEDULED_ORDER_UNAVAILABLE_MESSAGE = 'Scheduled bookings are not available right now';
