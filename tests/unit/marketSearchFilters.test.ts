/**
 * Unit Tests for Market Search Multi-Dimensional Filtering and Neutral Sorting.
 *
 * Validates pure filter functions in src/lib/search/filters.ts:
 * - filterByModality
 * - filterByFeature (structured fields)
 * - filterByCancellation
 * - filterByBudget
 * - sortFacilities
 * - applyAllSearchFilters
 */

import { describe, it, expect } from "vitest";
import type { FacilityWithServices, PriceSnapshotV3 } from "@/types/domain";
import {
  filterByModality,
  filterByFeature,
  filterByCancellation,
  filterByBudget,
  sortFacilities,
  applyAllSearchFilters,
} from "@/lib/search/filters";

function createMockFacility(opts: {
  id: string;
  name: string;
  modality: "valet" | "shuttle";
  totalAmountCents?: number;
  evStatus?: "verified" | "not_available" | "unknown";
  washStatus?: "verified" | "not_available" | "unknown";
  freeCancHours?: number;
}): FacilityWithServices {
  const quote: PriceSnapshotV3 | undefined = opts.totalAmountCents
    ? {
        service_id: `srv-${opts.id}`,
        service_name: `Servicio ${opts.name}`,
        currency: "EUR",
        pricing_unit: "per_day",
        duration_hours: 48,
        units: 2,
        supplier_base_amount: opts.totalAmountCents - 999,
        platform_markup_amount: 800,
        booking_management_fee_amount: 199,
        extras_amount: 0,
        discount_amount: 0,
        tax_amount: 0,
        customer_total_amount: opts.totalAmountCents,
        total_amount: opts.totalAmountCents,
        calculation_version: 3,
        applied_rules: [],
        selected_extras: [],
        breakdown: [],
        b2b_settlement: {
          commission_rate_bps: 1000,
          commission_basis_amount: opts.totalAmountCents - 999,
          commission_amount: 100,
          operator_payout_amount: opts.totalAmountCents - 999 - 100,
        },
      }
    : undefined;

  return {
    id: opts.id,
    operator_id: `op-${opts.id}`,
    airport_id: "a0000000-0000-4000-a000-000000000001",
    name: opts.name,
    address: `Zona Aeroportuaria ${opts.name}`,
    latitude: 40.49,
    longitude: -3.56,
    total_capacity: 50,
    operational_buffer: 5,
    feature_ev_charging: opts.evStatus ?? "unknown",
    feature_car_wash: opts.washStatus ?? "unknown",
    feature_covered: "unknown",
    feature_cctv_24h: "unknown",
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-26T00:00:00Z",
    operator: {
      id: `op-${opts.id}`,
      name: `Operador ${opts.name}`,
      currency: "EUR",
    },
    services: [
      {
        id: `srv-${opts.id}`,
        facility_id: opts.id,
        name: opts.modality === "valet" ? "Valet en Terminal" : "Lanzadera Shuttle",
        description: "Servicio de parking",
        price_amount: opts.totalAmountCents ?? 0,
        currency: "EUR",
        pricing_unit: "per_day",
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
    extras: [],
    cancellation_policy: opts.freeCancHours !== undefined
      ? {
          id: `canc-${opts.id}`,
          operator_id: `op-${opts.id}`,
          legal_document_id: "00000000-0000-4000-b000-000000000003",
          free_cancellation_window_hours: opts.freeCancHours,
          late_cancellation_fee_bps: 5000,
          no_show_fee_bps: 10000,
          allow_modifications: true,
          modification_window_hours: 2,
          active: true,
          created_at: "2026-10-26T00:00:00Z",
        }
      : null,
    server_quote: quote,
  };
}

describe("Market Search Multi-Dimensional Filtering & Sorting", () => {
  const facValet1 = createMockFacility({
    id: "fac-1",
    name: "VIP Valet Express",
    modality: "valet",
    totalAmountCents: 4500,
    evStatus: "verified",
    freeCancHours: 24,
  });

  const facShuttle1 = createMockFacility({
    id: "fac-2",
    name: "LowCost Shuttle Lanzadera",
    modality: "shuttle",
    totalAmountCents: 2800,
    washStatus: "verified",
    freeCancHours: 12,
  });

  const facValet2 = createMockFacility({
    id: "fac-3",
    name: "AeroValet Premium Barajas",
    modality: "valet",
    totalAmountCents: 5200,
    evStatus: "verified",
    washStatus: "verified",
    freeCancHours: 48,
  });

  const facManualConsult = createMockFacility({
    id: "fac-4",
    name: "Parking Corporativo Flotas",
    modality: "valet",
    totalAmountCents: undefined, // Under consultation / no automated quote
    freeCancHours: 0,
  });

  const allFacilities = [facValet1, facShuttle1, facValet2, facManualConsult];

  it("filters facilities strictly by modality", () => {
    const valets = filterByModality(allFacilities, "valet");
    expect(valets.map((f) => f.id)).toEqual(["fac-1", "fac-3", "fac-4"]);

    const shuttles = filterByModality(allFacilities, "shuttle");
    expect(shuttles.map((f) => f.id)).toEqual(["fac-2"]);
  });

  it("filters facilities by verified structured features only", () => {
    const evParkings = filterByFeature(allFacilities, "ev");
    expect(evParkings.map((f) => f.id)).toEqual(["fac-1", "fac-3"]);

    const washParkings = filterByFeature(allFacilities, "wash");
    expect(washParkings.map((f) => f.id)).toEqual(["fac-2", "fac-3"]);
  });

  it("filters facilities with free cancellation window >= 24h", () => {
    const flexible = filterByCancellation(allFacilities, "free_cancellation");
    expect(flexible.map((f) => f.id)).toEqual(["fac-1", "fac-3"]);
  });

  it("filters facilities within a maximum budget", () => {
    const budget3000 = filterByBudget(allFacilities, 3000);
    expect(budget3000.map((f) => f.id)).toEqual(["fac-2"]);

    const budget5000 = filterByBudget(allFacilities, 5000);
    expect(budget5000.map((f) => f.id)).toEqual(["fac-1", "fac-2"]);
  });

  it("sorts facilities strictly by customer_total_amount ascending", () => {
    const sorted = sortFacilities(allFacilities, "price_asc");
    // fac-2 (2800) < fac-1 (4500) < fac-3 (5200) < fac-4 (Infinity)
    expect(sorted.map((f) => f.id)).toEqual(["fac-2", "fac-1", "fac-3", "fac-4"]);
  });

  it("applies composite multi-criteria search filtering", () => {
    const results = applyAllSearchFilters(allFacilities, {
      modality: "valet",
      feature: "ev",
      cancellation: "free_cancellation",
      maxBudgetCents: 5000,
      sortBy: "price_asc",
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("fac-1");
  });
});
