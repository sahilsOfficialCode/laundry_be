import { isInstantAvailable } from './instant-availability';

describe('isInstantAvailable', () => {
  const ORIGINAL_ENV = process.env.INSTANT_ORDER_CUTOFF_TIME;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.INSTANT_ORDER_CUTOFF_TIME;
    } else {
      process.env.INSTANT_ORDER_CUTOFF_TIME = ORIGINAL_ENV;
    }
  });

  // IST = UTC+5:30, so 14:29:59 UTC is 19:59:59 IST and 14:30:00 UTC is
  // 20:00:00 IST — the boundary around the default 20:00 cutoff.
  const justBeforeDefaultCutoffUTC = new Date('2026-07-12T14:29:59.000Z');
  const atDefaultCutoffUTC = new Date('2026-07-12T14:30:00.000Z');
  const afterDefaultCutoffUTC = new Date('2026-07-12T15:00:00.000Z');

  it('returns true before the default 20:00 IST cutoff', () => {
    delete process.env.INSTANT_ORDER_CUTOFF_TIME;
    expect(isInstantAvailable(justBeforeDefaultCutoffUTC)).toBe(true);
  });

  it('returns false at/after the default 20:00 IST cutoff', () => {
    delete process.env.INSTANT_ORDER_CUTOFF_TIME;
    expect(isInstantAvailable(atDefaultCutoffUTC)).toBe(false);
    expect(isInstantAvailable(afterDefaultCutoffUTC)).toBe(false);
  });

  it('respects a configured INSTANT_ORDER_CUTOFF_TIME', () => {
    process.env.INSTANT_ORDER_CUTOFF_TIME = '18:00';
    // 12:00 UTC = 17:30 IST -> still before 18:00 cutoff
    expect(isInstantAvailable(new Date('2026-07-12T12:00:00.000Z'))).toBe(true);
    // 12:30 UTC = 18:00 IST -> at cutoff, unavailable
    expect(isInstantAvailable(new Date('2026-07-12T12:30:00.000Z'))).toBe(false);
  });

  it('falls back to the default cutoff when the env var is malformed', () => {
    process.env.INSTANT_ORDER_CUTOFF_TIME = 'not-a-time';
    expect(isInstantAvailable(justBeforeDefaultCutoffUTC)).toBe(true);
    expect(isInstantAvailable(atDefaultCutoffUTC)).toBe(false);
  });

  // Regression test for the module-load-time caching bug: ConfigModule loads
  // .env *after* Node has already resolved this module's imports, so if the
  // cutoff were cached at import time it would permanently miss whatever is
  // actually in .env. isInstantAvailable() must re-read process.env on every
  // call, with no module-level import-order dependency.
  it('picks up a changed env var without re-importing the module', () => {
    delete process.env.INSTANT_ORDER_CUTOFF_TIME;
    expect(isInstantAvailable(new Date('2026-07-12T12:30:00.000Z'))).toBe(true); // 18:00 IST, before default 20:00

    process.env.INSTANT_ORDER_CUTOFF_TIME = '18:00';
    expect(isInstantAvailable(new Date('2026-07-12T12:30:00.000Z'))).toBe(false); // 18:00 IST, now at the new cutoff
  });
});
