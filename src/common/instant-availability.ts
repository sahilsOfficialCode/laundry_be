const DEFAULT_INSTANT_ORDER_CUTOFF_TIME = '20:00';

const CUTOFF_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const INSTANT_ORDER_UNAVAILABLE_MESSAGE =
  "Instant orders are unavailable after today's cutoff time. Please choose a scheduled pickup.";

/**
 * Returns the current time as an HH:MM string in IST (UTC+5:30). Mirrors the
 * convention standard-time-slots.service.ts uses for its own slot cutoffs.
 */
function toISTTimeString(date: Date): string {
  const nowMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const h = Math.floor((nowMs / (60 * 60 * 1000)) % 24);
  const m = Math.floor((nowMs / (60 * 1000)) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Read fresh on every call, deliberately not cached: this app loads .env via
// ConfigModule.forRoot() (app.module.ts), which runs *after* Node has already
// resolved every import in the module graph — including this file's — so a
// module-load-time read would silently see process.env before .env exists
// and get stuck on the default forever. The read itself is a hash-map lookup
// plus a 5-char regex test, run at most a few times per checkout request —
// not worth trading correctness for.
function getInstantOrderCutoffTime(): string {
  const raw = process.env.INSTANT_ORDER_CUTOFF_TIME?.trim();
  return raw && CUTOFF_TIME_PATTERN.test(raw)
    ? raw
    : DEFAULT_INSTANT_ORDER_CUTOFF_TIME;
}

/**
 * Single source of truth for whether Instant orders are being accepted right
 * now. Slot generation (standard-time-slots.service.ts) and order validation
 * (locations.service.ts, orders.service.ts) all call this so the cutoff rule
 * lives in exactly one place.
 */
export function isInstantAvailable(now: Date = new Date()): boolean {
  return toISTTimeString(now) < getInstantOrderCutoffTime();
}
