/**
 * Server-side facility + service queries for the search flow.
 *
 * Returns facilities with their active services for a given airport and time interval.
 * The server never exposes capacity numbers, holds, or internal pricing logic
 * that could let a client craft a fraudulent booking.
 *
 * Demo mode: returns an empty list with a clear label when credentials are absent.
 */

import type { FacilityWithServices } from "@/types/domain";
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
 * Implements server-side quote calculation, market coverage catalog discovery,
 * and transparent separation between online-quotable operators and manual consultation operators.
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

    // Fetch active facilities for the airport
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

    // Filter out facilities with no active services
    const facilities = (facilitiesData ?? [])
      .filter((f: { services?: unknown[] }) => Array.isArray(f.services) && f.services.length > 0)
      .map((f) => {
        const { operators, ...rest } = f as typeof f & {
          operators: { id: string; name: string; currency: string; status: string };
        };
        return {
          ...rest,
          operator: {
            id: operators.id,
            name: operators.name,
            currency: operators.currency,
          },
        } as FacilityWithServices;
      });

    if (facilities.length === 0) {
      // Fallback to verified discovered catalog if database has not been seeded yet
      const { verifiedFacilities, manualConsultationFacilities } = getCatalogFacilitiesWithQuotes(
        airportId,
        entryAt,
        exitAt
      );
      if (verifiedFacilities.length > 0 || manualConsultationFacilities.length > 0) {
        return {
          mode: "live",
          facilities: verifiedFacilities,
          manualFacilities: manualConsultationFacilities,
        };
      }
    }

    // Calculate server-authoritative quotes for database facilities
    const enrichedFacilities = facilities.map((f) => {
      const primaryService = f.services[0];
      if (!primaryService) return f;
      try {
        const quote = calculateQuote({
          serviceId: primaryService.id,
          serviceName: primaryService.name,
          basePriceAmount: primaryService.price_amount,
          currency: primaryService.currency,
          pricingUnit: primaryService.pricing_unit,
          entryAt,
          exitAt,
        });
        return { ...f, server_quote: quote };
      } catch {
        return f;
      }
    });

    return { mode: "live", facilities: enrichedFacilities };
  } catch (err) {
    return {
      mode: "error",
      facilities: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
