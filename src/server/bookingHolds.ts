/**
 * Server-side booking hold service.
 *
 * Implements atomic hold creation invoking the PostgreSQL RPC create_booking_hold.
 * The server is the sole authority for price calculation and capacity verification.
 * No client-submitted prices or capacities are ever trusted.
 */

"use server";

import type { CreateHoldParams, HoldResult } from "@/types/domain";
import { createBookingHoldSchema } from "@/lib/schemas/bookingHold";
import { calculateQuote } from "@/lib/pricing/engine";

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export interface CreateHoldResponse {
  success: boolean;
  hold?: HoldResult;
  error?: string;
  code?: string;
  isDemo?: boolean;
}

/**
 * Request an atomic booking hold on a facility.
 *
 * Serializes capacity checking and hold insertion in PostgreSQL using FOR UPDATE.
 * Prevents overselling when multiple concurrent requests compete for the last available spot.
 */
export async function createBookingHoldAction(
  params: CreateHoldParams
): Promise<CreateHoldResponse> {
  // 1. Zod input validation
  const validation = createBookingHoldSchema.safeParse(params);
  if (!validation.success) {
    const firstIssue = validation.error.issues[0];
    return {
      success: false,
      error: firstIssue ? firstIssue.message : "Parámetros de reserva no válidos",
      code: "VALIDATION_ERROR",
    };
  }

  const validData = validation.data;

  // 2. Demo Mode Fallback (when local credentials are not configured)
  if (isDemoMode()) {
    // Deterministic server-side calculation for demo visualization
    // Never disguised as a persistent database booking
    const demoQuote = calculateQuote({
      serviceId: validData.service_id,
      serviceName: "Servicio Demo AeroValet",
      basePriceAmount: 1500, // 15.00 EUR per day in minor units
      currency: "EUR",
      pricingUnit: "per_day",
      entryAt: validData.entry_at,
      exitAt: validData.exit_at,
      vehicleCategory: validData.vehicle_category ?? "standard",
      selectedExtras: validData.selected_extras ?? [],
    });

    return {
      success: true,
      isDemo: true,
      hold: {
        hold_id: `demo-hold-${Date.now()}`,
        facility_id: validData.facility_id,
        service_id: validData.service_id,
        entry_at: validData.entry_at,
        exit_at: validData.exit_at,
        status: "active",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        price_amount: demoQuote.total_amount,
        currency: "EUR",
        pricing_unit: "per_day",
        units: demoQuote.units,
        price_snapshot: demoQuote,
      },
    };
  }

  // 3. Live Supabase RPC invocation
  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc("create_booking_hold", {
      p_facility_id: validData.facility_id,
      p_service_id: validData.service_id,
      p_entry_at: validData.entry_at,
      p_exit_at: validData.exit_at,
      p_vehicle_id: validData.vehicle_id ?? null,
      p_customer_id: validData.customer_id ?? null,
      p_guest_email: validData.guest_email ?? null,
      p_guest_name: validData.guest_name ?? null,
      p_guest_phone: validData.guest_phone ?? null,
      p_vehicle_category: validData.vehicle_category ?? null,
      p_selected_extras: validData.selected_extras ?? [],
    });

    if (error) {
      // Map PostgreSQL custom error codes to user-friendly messages
      if (error.message.includes("CAPACITY_EXHAUSTED")) {
        return {
          success: false,
          error: "No hay plazas disponibles para las fechas seleccionadas.",
          code: "CAPACITY_EXHAUSTED",
        };
      }
      if (error.message.includes("FACILITY_NOT_AVAILABLE")) {
        return {
          success: false,
          error: "El aparcamiento seleccionado no está disponible.",
          code: "FACILITY_NOT_AVAILABLE",
        };
      }
      if (error.message.includes("SERVICE_NOT_AVAILABLE")) {
        return {
          success: false,
          error: "El servicio solicitado no está activo.",
          code: "SERVICE_NOT_AVAILABLE",
        };
      }
      if (error.message.includes("DURATION_TOO_SHORT")) {
        return {
          success: false,
          error: "La estancia mínima de reserva es de 30 minutos.",
          code: "DURATION_TOO_SHORT",
        };
      }
      if (error.message.includes("ENTRY_MUST_BE_IN_FUTURE")) {
        return {
          success: false,
          error: "La hora de entrada debe ser posterior a la hora actual.",
          code: "ENTRY_MUST_BE_IN_FUTURE",
        };
      }

      return {
        success: false,
        error: error.message || "Error al procesar la reserva temporal.",
        code: error.code || "DB_ERROR",
      };
    }

    const holdResult = data as HoldResult;
    return {
      success: true,
      hold: holdResult,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error inesperado del servidor",
      code: "SERVER_ERROR",
    };
  }
}

/**
 * Check the current status of a hold.
 */
export async function getBookingHoldStatusAction(
  holdId: string
): Promise<HoldResult | null> {
  if (isDemoMode() || holdId.startsWith("demo-hold-")) {
    return null;
  }

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc("get_booking_hold_status", {
      p_hold_id: holdId,
    });

    if (error || !data) {
      return null;
    }

    return data as HoldResult;
  } catch {
    return null;
  }
}
