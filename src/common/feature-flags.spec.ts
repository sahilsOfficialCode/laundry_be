import { isDropAtShopDirectSelectionEnabled } from './feature-flags';

describe('isDropAtShopDirectSelectionEnabled', () => {
  const ORIGINAL_ENV = process.env.DROP_AT_SHOP_DIRECT_SELECTION;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DROP_AT_SHOP_DIRECT_SELECTION;
    } else {
      process.env.DROP_AT_SHOP_DIRECT_SELECTION = ORIGINAL_ENV;
    }
  });

  it('defaults to enabled when the env var is unset', () => {
    delete process.env.DROP_AT_SHOP_DIRECT_SELECTION;
    expect(isDropAtShopDirectSelectionEnabled()).toBe(true);
  });

  it('is disabled only by the literal string "false" (case/whitespace-insensitive)', () => {
    process.env.DROP_AT_SHOP_DIRECT_SELECTION = 'false';
    expect(isDropAtShopDirectSelectionEnabled()).toBe(false);

    process.env.DROP_AT_SHOP_DIRECT_SELECTION = ' FALSE ';
    expect(isDropAtShopDirectSelectionEnabled()).toBe(false);
  });

  it('stays enabled for any other value, including common typos', () => {
    process.env.DROP_AT_SHOP_DIRECT_SELECTION = 'true';
    expect(isDropAtShopDirectSelectionEnabled()).toBe(true);

    process.env.DROP_AT_SHOP_DIRECT_SELECTION = '0';
    expect(isDropAtShopDirectSelectionEnabled()).toBe(true);
  });

  // Regression test for the same module-load-time caching pitfall as
  // instant-availability.ts: ConfigModule loads .env after this module's
  // imports resolve, so the flag must re-read process.env on every call.
  it('picks up a changed env var without re-importing the module', () => {
    delete process.env.DROP_AT_SHOP_DIRECT_SELECTION;
    expect(isDropAtShopDirectSelectionEnabled()).toBe(true);

    process.env.DROP_AT_SHOP_DIRECT_SELECTION = 'false';
    expect(isDropAtShopDirectSelectionEnabled()).toBe(false);
  });
});
