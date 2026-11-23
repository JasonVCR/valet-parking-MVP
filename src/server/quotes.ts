/**
 * Server-side quote service.
 *
 * Provides authoritative price quotations by calling the PostgreSQL RPC
 * calculate_service_quote. In demo mode, falls back to the TypeScript engine.
 *
 * This action is used by ParkingDetailModal to get live quotes when extras change.
 */

"use server";

import type { PriceSnapshotV3, SelectedExtraInput } from "@/types/domain";
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

/**
 * Request an authoritative quote from PostgreSQL (or demo engine fallback).
 */
export async function getServiceQuoteAction(params: {
  service_id: string;
  entry_at: string;
  exit_at: string;
  vehicle_category?: string | null;
  selected_extras?: SelectedExtraInput[];
}): Promise<QuoteResponse> {
  // Demo Mode Fallback
  if (isDemoMode()) {
    try {
      const { SYNTHETIC_DEMO_CATALOG } = await import("@/data/demoCatalog");
      // Find the catalog entry that contains this service
      const catalogEntry = SYNTHETIC_DEMO_CATALOG.find((e) =>
        e.facility.services.some((s) => s.id === params.service_id)
      );

      if (!catalogEntry) {
        return {
          success: false,
          error: "Servicio no encontrado en el catálogo demo",
          code: "SERVICE_NOT_FOUND",
        };
      }

      const service = catalogEntry.facility.services.find(
        (s) => s.id === params.service_id
      )!;

      const quote = calculateQuote({
        serviceId: service.id,
        serviceName: service.name,
        basePriceAmount: service.price_amount,
        currency: service.currency,
        pricingUnit: service.pricing_unit,
        entryAt: params.entry_at,
        exitAt: params.exit_at,
        vehicleCategory: (params.vehicle_category as "standard" | "suv" | "van" | "motorcycle") ?? "standard",
        tariffBands: catalogEntry.tariffBands ?? [],
        availableExtras: catalogEntry.extras ?? [],
        selectedExtras: params.selected_extras ?? [],
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

  // Live Supabase RPC
  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc("calculate_service_quote", {
      p_service_id: params.service_id,
      p_entry_at: params.entry_at,
      p_exit_at: params.exit_at,
      p_vehicle_category: params.vehicle_category ?? null,
      p_selected_extras: params.selected_extras ?? [],
    });

    if (error) {
      // Map known errors
      if (error.message.includes("NO_VERIFIED_TARIFF_SOURCE")) {
        return {
          success: false,
          error: "No se dispone de tarifa verificada para este servicio. Consulte directamente con el operador.",
          code: "NO_VERIFIED_TARIFF_SOURCE",
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

    return { success: true, quote: data as PriceSnapshotV3 };
  } catch (err) {
    // Fail-closed: no fallback to TypeScript pricing in live mode
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error inesperado del servidor",
      code: "SERVER_ERROR",
    };
  }
}
