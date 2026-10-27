/**
 * Server-side facility + service queries for the search flow.
 *
 * Returns facilities with their active services, verified tariff bands,
 * active extras, and genuine cancellation policies for a given airport and time interval.
 *
 * Implements strict live database querying with verified source constraints,
 * and safe fallback to isolated synthetic fixtures when running in local demo mode.
 */

import type {
  FacilityWithServices,
  ServiceTariffBand,
  ServiceExtra,
  CancellationPolicyRule,
} from "@/types/domain";
import { getCatalogFacilitiesWithQuotes } from "@/server/discovery/catalog";
import { calculateQuote } from "@/lib/pricing/engine";

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type FacilitiesResult =
  | { mode: "live"; facilities: FacilityWithServices[]; manualFacilities?: FacilityWithServices[] }
  | { mode: "demo"; facilities: FacilityWithServices[]; manualFacilities?: FacilityWithServices[] }
  | { mode: "error"; facilities: FacilityWithServices[]; manualFacilities?: FacilityWithServices[]; error: string };

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch active facilities (with their active services, verified tariffs and operator info) for an airport.
 *
 * In live mode, queries Supabase facilities, verified tariff bands, extras and cancellation policies.
 * In demo mode, delegates to clearly labeled synthetic fixtures in demoCatalog.
 *
 * @param airportId - UUID of the airport
 * @param entryAt   - entry timestamp (ISO string)
 * @param exitAt    - exit timestamp (ISO string)
 */
export async function getFacilitiesWithServices(
  airportId: string,
  entryAt: string,
  exitAt: string
): Promise<FacilitiesResult> {
  if (isDemoMode()) {
    const { verifiedFacilities, manualConsultationFacilities } = getCatalogFacilitiesWithQuotes(
      airportId,
      entryAt,
      exitAt
    );
    return {
      mode: "demo",
      facilities: verifiedFacilities,
      manualFacilities: manualConsultationFacilities,
    };
  }

  try {
    const { createSupabaseServerClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createSupabaseServerClient();

    // 1. Fetch active facilities and operators for the airport
    const { data: facilitiesData, error: facilityError } = await supabase
      .from("facilities")
      .select(
        `
        id,
        operator_id,
        airport_id,
        name,
        address,
        latitude,
        longitude,
        total_capacity,
        operational_buffer,
        active,
        created_at,
        updated_at,
        operators!inner (
          id,
          name,
          currency,
          status
        ),
        services (
          id,
          facility_id,
          name,
          description,
          price_amount,
          currency,
          pricing_unit,
          active,
          created_at,
          updated_at
        )
        `
      )
      .eq("airport_id", airportId)
      .eq("active", true)
      .eq("operators.status", "active")
      .eq("services.active", true)
      .order("name", { ascending: true });

    if (facilityError) {
      return { mode: "error", facilities: [], error: facilityError.message };
    }

    if (!facilitiesData || facilitiesData.length === 0) {
      return { mode: "live", facilities: [], manualFacilities: [] };
    }

    // 2. Fetch verified tariff bands, active extras and cancellation policies
    const facilityIds = facilitiesData.map((f: { id: string }) => f.id);
    const operatorIds = Array.from(new Set(facilitiesData.map((f: { operator_id: string }) => f.operator_id)));

    const [bandsResult, extrasResult, policiesResult] = await Promise.all([
      supabase
        .from("service_tariff_bands")
        .select("*")
        .eq("active", true),
      supabase
        .from("service_extras")
        .select("*")
        .in("facility_id", facilityIds)
        .eq("active", true),
      supabase
        .from("cancellation_policy_rules")
        .select("*")
        .in("operator_id", operatorIds)
        .eq("active", true),
    ]);

    const allBands: ServiceTariffBand[] = (bandsResult.data ?? []) as ServiceTariffBand[];
    const allExtras: ServiceExtra[] = (extrasResult.data ?? []) as ServiceExtra[];
    const allPolicies: CancellationPolicyRule[] = (policiesResult.data ?? []) as CancellationPolicyRule[];

    const verifiedFacilities: FacilityWithServices[] = [];
    const manualConsultationFacilities: FacilityWithServices[] = [];

    for (const f of facilitiesData) {
      const { operators, services, ...rest } = f as typeof f & {
        operators: { id: string; name: string; currency: string; status: string };
        services: Array<{
          id: string;
          facility_id: string;
          name: string;
          description: string | null;
          price_amount: number;
          currency: string;
          pricing_unit: "per_stay" | "per_day" | "per_hour";
          active: boolean;
          created_at: string;
          updated_at: string;
        }>;
      };

      if (!services || services.length === 0) continue;

      const primaryService = services[0];
      const facilityBands = allBands.filter((b) => b.service_id === primaryService.id);
      const facilityExtras = allExtras.filter((e) => e.facility_id === rest.id);
      const cancellationPolicy = allPolicies.find((p) => p.operator_id === rest.operator_id) ?? null;

      let quote = null;
      try {
        quote = calculateQuote({
          serviceId: primaryService.id,
          serviceName: primaryService.name,
          basePriceAmount: primaryService.price_amount,
          currency: primaryService.currency,
          pricingUnit: primaryService.pricing_unit,
          entryAt,
          exitAt,
          tariffBands: facilityBands,
          availableExtras: facilityExtras,
        });
      } catch {
        // Quote unavailable or exceeds configured bands
        quote = null;
      }

      const enriched: FacilityWithServices = {
        ...rest,
        operator: {
          id: operators.id,
          name: operators.name,
          currency: operators.currency,
        },
        services,
        tariff_bands: facilityBands,
        extras: facilityExtras,
        cancellation_policy: cancellationPolicy,
        server_quote: quote,
      };

      if (quote) {
        verifiedFacilities.push(enriched);
      } else {
        manualConsultationFacilities.push(enriched);
      }
    }

    // Sort verified facilities by total amount ascending (neutral ranking)
    verifiedFacilities.sort((a, b) => {
      const priceA = a.server_quote?.customer_total_amount ?? Infinity;
      const priceB = b.server_quote?.customer_total_amount ?? Infinity;
      return priceA - priceB;
    });

    return {
      mode: "live",
      facilities: verifiedFacilities,
      manualFacilities: manualConsultationFacilities,
    };
  } catch (err) {
    return {
      mode: "error",
      facilities: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
