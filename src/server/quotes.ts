/**
 * Server-side quote service.
 *
 * Provides authoritative price quotations by calling the PostgreSQL RPC
 * calculate_service_quote with facility validation.
 *
 * Security guarantees:
 * - Zod input validation on all parameters.
 * - Strict verification that service belongs to the declared facility.
 * - Verification that facility and operator are active.
 * - Total separation between demo mode and live database.
 */

"use server";

import type { PriceSnapshotV3, SelectedExtraInput } from "@/types/domain";
import { getServiceQuoteSchema } from "@/lib/schemas/quote";
import { calculateQuote } from "@/lib/pricing/engine";

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export interface QuoteResponse {
  success: boolean;
  quote?: PriceSnapshotV3;
  error?: string;
  code?: string;
  isDemo?: boolean;
}

export interface GetQuoteParams {
  facility_id: string;
  service_id: string;
  entry_at: string;
  exit_at: string;
  vehicle_category?: string | null;
  selected_extras?: SelectedExtraInput[];
}

/**
 * Request an authoritative quote from PostgreSQL (or demo engine fallback).
 */
export async function getServiceQuoteAction(params: GetQuoteParams): Promise<QuoteResponse> {
  // 1. Zod input validation
  const validation = getServiceQuoteSchema.safeParse(params);
  if (!validation.success) {
    const firstIssue = validation.error.issues[0];
    return {
      success: false,
      error: firstIssue ? firstIssue.message : "Parámetros de cotización no válidos",
      code: "VALIDATION_ERROR",
    };
  }

  const validData = validation.data;

  // 2. Demo Mode Fallback
  if (isDemoMode() || validData.facility_id.startsWith("demo-")) {
    try {
      const { SYNTHETIC_DEMO_CATALOG } = await import("@/data/demoCatalog");
      // Find facility
      const catalogEntry = SYNTHETIC_DEMO_CATALOG.find((e) => e.facility.id === validData.facility_id);

      if (!catalogEntry) {
        return {
          success: false,
          error: "Instalación no encontrada en el catálogo de demostración",
          code: "FACILITY_NOT_FOUND",
        };
      }

      if (!catalogEntry.facility.active) {
        return {
          success: false,
          error: "La instalación seleccionada no se encuentra activa",
          code: "FACILITY_NOT_ACTIVE",
        };
      }

      const service = catalogEntry.facility.services.find(
        (s) => s.id === validData.service_id
      );

      if (!service) {
        return {
          success: false,
          error: "El servicio no pertenece a la instalación indicada o no existe",
          code: "SERVICE_FACILITY_MISMATCH",
        };
      }

      if (!service.active) {
        return {
          success: false,
          error: "El servicio seleccionado no está activo",
          code: "SERVICE_NOT_ACTIVE",
        };
      }

      const quote = calculateQuote({
        serviceId: service.id,
        serviceName: service.name,
        basePriceAmount: service.price_amount,
        currency: service.currency,
        pricingUnit: service.pricing_unit,
        entryAt: validData.entry_at,
        exitAt: validData.exit_at,
        vehicleCategory: (validData.vehicle_category as "standard" | "suv" | "van" | "motorcycle") ?? "standard",
        tariffBands: catalogEntry.tariffBands ?? [],
        availableExtras: catalogEntry.extras ?? [],
        selectedExtras: validData.selected_extras ?? [],
      });

      return { success: true, quote, isDemo: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Error calculando cotización demo",
        code: "QUOTE_CALCULATION_ERROR",
      };
    }
  }

  // 3. Live Supabase RPC
  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc("calculate_service_quote", {
      p_service_id: validData.service_id,
      p_entry_at: validData.entry_at,
      p_exit_at: validData.exit_at,
      p_vehicle_category: validData.vehicle_category ?? null,
      p_selected_extras: validData.selected_extras ?? [],
      p_facility_id: validData.facility_id,
    });

    if (error) {
      if (error.message.includes("SERVICE_FACILITY_MISMATCH")) {
        return {
          success: false,
          error: "El servicio no pertenece a la instalación indicada.",
          code: "SERVICE_FACILITY_MISMATCH",
        };
      }

      if (error.message.includes("NO_VERIFIED_TARIFF_SOURCE")) {
        return {
          success: false,
          error: "No se dispone de tarifa verificada para este servicio. Consulte directamente con el operador.",
          code: "NO_VERIFIED_TARIFF_SOURCE",
        };
      }

      if (error.message.includes("OPERATOR_NOT_ACTIVE")) {
        return {
          success: false,
          error: "El operador del aparcamiento no está operativo en este momento.",
          code: "OPERATOR_NOT_ACTIVE",
        };
      }

      return {
        success: false,
        error: error.message || "Error al obtener la cotización del servidor.",
        code: error.code || "RPC_ERROR",
      };
    }

    if (!data) {
      return {
        success: false,
        error: "El servidor no devolvió cotización.",
        code: "EMPTY_QUOTE",
      };
    }

    return { success: true, quote: data as PriceSnapshotV3, isDemo: false };
  } catch (err) {
    // Fail-closed: no fallback to TypeScript pricing in live mode
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error inesperado del servidor",
      code: "SERVER_ERROR",
    };
  }
}
