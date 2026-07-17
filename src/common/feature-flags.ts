/**
 * Kill switch for the Drop-at-Shop DIRECT_SELECTION location-assignment mode
 * (see LocationsService.validateSelectedLocation / OrdersService.initiateCheckout).
 * Defaults to enabled — set to the literal string 'false' to instantly revert
 * Drop-at-Shop checkout to the pre-existing AUTO_ASSIGN ($geoNear) behavior
 * without a redeploy, e.g. if an incident during rollout is traced here.
 *
 * Protection window: this only provides a clean rollback while the OLD
 * Flutter app (which still sends pickup coordinates for Drop at Shop) is
 * what's actually deployed — see the staged "backend first, then Flutter"
 * rollout. Once the NEW Flutter app is live (which stops sending coordinates
 * for Drop at Shop), disabling this flag would break Drop-at-Shop checkout
 * entirely, since neither assignment path would have the data it needs.
 *
 * Read fresh on every call, not cached at module load — see
 * instant-availability.ts's getInstantOrderCutoffTime for why (ConfigModule
 * loads .env after this module's imports are already resolved).
 */
export function isDropAtShopDirectSelectionEnabled(): boolean {
  return process.env.DROP_AT_SHOP_DIRECT_SELECTION?.trim().toLowerCase() !== 'false';
}
