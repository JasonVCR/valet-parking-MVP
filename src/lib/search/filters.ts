import type { FacilityWithServices } from "@/types/domain";

export type ModalityFilter = "all" | "valet" | "shuttle";
export type FeatureFilter = "all" | "ev" | "wash" | "covered";
export type CancellationFilter = "all" | "free_cancellation";
export type SortOption = "recommended" | "price_asc" | "name_asc";

export interface SearchFilterCriteria {
  modality: ModalityFilter;
  feature: FeatureFilter;
  cancellation: CancellationFilter;
  maxBudgetCents: number | null;
  sortBy: SortOption;
}

/**
 * Filter facilities by modality (valet vs shuttle/indicativo).
 */
export function filterByModality(
  facilities: FacilityWithServices[],
  modality: ModalityFilter
): FacilityWithServices[] {
  if (modality === "all") return facilities;
  return facilities.filter((f) => {
    if (f.modality === "valet" || f.modality === "shuttle") {
      return f.modality === modality;
    }
    const isValet =
      f.name.toLowerCase().includes("valet") ||
      f.services.some(
        (s) =>
          s.name.toLowerCase().includes("valet") ||
          s.name.toLowerCase().includes("vip") ||
          s.name.toLowerCase().includes("aparcacoches")
      );
    return modality === "valet" ? isValet : !isValet;
  });
}

/**
 * Filter facilities by verified structured features (EV charging, car wash, covered).
 * Strictly checks facility structured fields (`feature_ev_charging === 'verified'`),
 * never relying on unverified name substring matches.
 */
export function filterByFeature(
  facilities: FacilityWithServices[],
  feature: FeatureFilter
): FacilityWithServices[] {
  if (feature === "all") return facilities;

  return facilities.filter((f) => {
    if (feature === "ev") {
      return f.feature_ev_charging === "verified";
    }
    if (feature === "wash") {
      return f.feature_car_wash === "verified";
    }
    if (feature === "covered") {
      return f.feature_covered === "verified";
    }
    return true;
  });
}

/**
 * Filter facilities by cancellation policy (e.g. >= 24h free cancellation window).
 */
export function filterByCancellation(
  facilities: FacilityWithServices[],
  cancellation: CancellationFilter
): FacilityWithServices[] {
  if (cancellation === "all") return facilities;
  return facilities.filter(
    (f) => (f.cancellation_policy?.free_cancellation_window_hours ?? 0) >= 24
  );
}

/**
 * Filter facilities by maximum customer budget in cents.
 * Strictly uses server-authorized customer_total_amount when available.
 */
export function filterByBudget(
  facilities: FacilityWithServices[],
  maxBudgetCents: number | null
): FacilityWithServices[] {
  if (maxBudgetCents === null || maxBudgetCents <= 0) return facilities;
  return facilities.filter((f) => {
    // Strictly use server-authorized customer_total_amount; never fallback to services.price_amount
    const quoteAmount = f.server_quote?.customer_total_amount;
    if (quoteAmount !== undefined && quoteAmount !== null) {
      return quoteAmount <= maxBudgetCents;
    }
    return false;
  });
}

/**
 * Sort facilities deterministically.
 */
export function sortFacilities(
  facilities: FacilityWithServices[],
  sortBy: SortOption
): FacilityWithServices[] {
  const cloned = [...facilities];
  if (sortBy === "price_asc") {
    cloned.sort((a, b) => {
      const pA = a.server_quote?.customer_total_amount ?? Number.MAX_SAFE_INTEGER;
      const pB = b.server_quote?.customer_total_amount ?? Number.MAX_SAFE_INTEGER;
      return pA - pB;
    });
  } else if (sortBy === "name_asc") {
    cloned.sort((a, b) => a.name.localeCompare(b.name));
  }
  return cloned;
}

/**
 * Pure composite filter pipeline applying all search criteria.
 */
export function applyAllSearchFilters(
  facilities: FacilityWithServices[],
  criteria: SearchFilterCriteria
): FacilityWithServices[] {
  let result = filterByModality(facilities, criteria.modality);
  result = filterByFeature(result, criteria.feature);
  result = filterByCancellation(result, criteria.cancellation);
  result = filterByBudget(result, criteria.maxBudgetCents);
  result = sortFacilities(result, criteria.sortBy);
  return result;
}
