/**
 * Server-side airport queries.
 *
 * All functions use the anon Supabase client (RLS enforced).
 * Active airports only are returned — matches the airports_read_active RLS policy.
 *
 * When Supabase credentials are absent, returns DEMO_MODE data clearly labelled.
 * Never presents demo data as real availability.
 */

import type { Airport } from "@/types/domain";

// ─── Demo mode ────────────────────────────────────────────────────────────────

const DEMO_AIRPORTS: Airport[] = [
  {
    id: "a0000000-0000-4000-a000-000000000001",
    iata_code: "MAD",
    name: "Adolfo Suárez Madrid–Barajas",
    city: "Madrid",
    country_code: "ES",
    timezone: "Europe/Madrid",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "a0000000-0000-4000-a000-000000000002",
    iata_code: "BCN",
    name: "Josep Tarradellas Barcelona–El Prat",
    city: "Barcelona",
    country_code: "ES",
    timezone: "Europe/Madrid",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "a0000000-0000-4000-a000-000000000003",
    iata_code: "VLC",
    name: "Aeropuerto de Valencia",
    city: "Valencia",
    country_code: "ES",
    timezone: "Europe/Madrid",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
];

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export type AirportsResult =
  | { mode: "live"; airports: Airport[] }
  | { mode: "demo"; airports: Airport[] }
  | { mode: "error"; airports: Airport[]; error: string };

/**
 * Fetch all active airports.
 * Returns a tagged result so the UI can show an explicit demo/error notice.
 */
export async function getActiveAirports(): Promise<AirportsResult> {
  if (isDemoMode()) {
    return { mode: "demo", airports: DEMO_AIRPORTS };
  }

  try {
    // Dynamic import to avoid loading Supabase in demo mode
    const { createSupabaseServerClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from("airports")
      .select("id, iata_code, name, city, country_code, timezone, active, created_at")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) {
      return {
        mode: "error",
        airports: [],
        error: error.message,
      };
    }

    return { mode: "live", airports: (data ?? []) as Airport[] };
  } catch (err) {
    return {
      mode: "error",
      airports: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetch a single airport by id.
 */
export async function getAirportById(
  id: string
): Promise<Airport | null> {
  if (isDemoMode()) {
    return DEMO_AIRPORTS.find((a) => a.id === id) ?? null;
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("airports")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();

  if (error || !data) return null;
  return data as Airport;
}
