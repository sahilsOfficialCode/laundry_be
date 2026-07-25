/**
 * Billing unit a service/cloth-type is priced by. Lives in `pricing` (not
 * `services` or `cloth-types`) so both catalog modules can import it without
 * creating a circular module dependency.
 */
export enum PricingUnit {
  KG = 'kg',
  PIECE = 'piece',
  PAIR = 'pair',
  GARMENT = 'garment',
  ORDER = 'order',
}

export const PRICING_UNIT_LABELS: Record<PricingUnit, string> = {
  [PricingUnit.KG]: 'kg',
  [PricingUnit.PIECE]: 'pc',
  [PricingUnit.PAIR]: 'pair',
  [PricingUnit.GARMENT]: 'garment',
  [PricingUnit.ORDER]: 'order',
};
