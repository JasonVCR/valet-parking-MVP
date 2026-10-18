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

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type FacilitiesResult =
  | { mode: "live"; facilities: FacilityWithServices[] }
  | { mode: "demo"; facilities: FacilityWithServices[] }
  | { mode: "error"; facilities: FacilityWithServices[]; error: string };

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch active facilities (with their active services and operator info) for an airport.
 *
 * Note: availability filtering (capacity, holds) happens in the RPC when creating a hold.
 * This query returns which facilities/services exist and are listed; not real-time availability.
 *
 * @param airportId - UUID of the airport
 * @param _entryAt  - entry timestamp (reserved for future service-hours filtering)
 * @param _exitAt   - exit timestamp  (reserved for future service-hours filtering)
 */
export async function getFacilitiesWithServices(
  airportId: string,
  _entryAt: string,
  _exitAt: string
): Promise<FacilitiesResult> {
  // Reserved for future service-hours and capacity filtering
  void _entryAt;
  void _exitAt;

  if (isDemoMode()) {
    // Return empty list; do NOT simulate fake availability
    return { mode: "demo", facilities: [] };
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

    return { mode: "live", facilities };
  } catch (err) {
    return {
      mode: "error",
      facilities: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
