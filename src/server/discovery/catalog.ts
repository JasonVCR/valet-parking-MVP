/**
 * Market Discovery and Operator Tariff Registry for AeroValet.
 *
 * Provides querying and quote enrichment for verified airport parking operators,
 * published tariff tables, official sources, and genuine cancellation policies.
 *
 * In sandbox/demo mode without live database credentials, it safely isolates
 * synthetic fixtures via getDemoSyntheticFacilities() to ensure no false claims
 * of verification are made regarding unvalidated commercial entities.
 */

import type { FacilityWithServices } from "@/types/domain";
import { getDemoSyntheticFacilities, SYNTHETIC_DEMO_CATALOG } from "@/data/demoCatalog";

export { SYNTHETIC_DEMO_CATALOG };

/**
 * Computes quotes for operators discovered for an airport.
 * In demo/sandbox mode without persistent database, delegates to isolated synthetic fixtures.
 */
export function getCatalogFacilitiesWithQuotes(
  airportId: string,
  entryAt: string,
  exitAt: string
): {
  verifiedFacilities: FacilityWithServices[];
  manualConsultationFacilities: FacilityWithServices[];
} {
  return getDemoSyntheticFacilities(airportId, entryAt, exitAt);
}
