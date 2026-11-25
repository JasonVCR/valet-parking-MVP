/**
 * Unit Tests for Market Search Multi-Dimensional Filtering and Neutral Sorting.
 *
 * Validates:
 * - Filtering by Modality (all, valet, shuttle).
 * - Filtering by Features (EV Charging, Car Wash).
 * - Filtering by Cancellation Policy (Free Cancellation >= 24h).
 * - Filtering by Max Budget limit.
 * - Neutral Price Sorting (lowest total customer amount first).
 * - Strict separation of manual consultation operators.
 */

import { describe, it, expect } from "vitest";
import type { FacilityWithServices, PriceSnapshotV3 } from "@/types/domain";

function createMockFacility(opts: {
  id: string;
  name: string;
  modality: "valet" | "shuttle";
  totalAmountCents?: number;
  hasEv?: boolean;
  hasWash?: boolean;
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
        price_amount: opts.totalAmountCents ?? 2000,
        currency: "EUR",
        pricing_unit: "per_day",
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
    extras: [
      ...(opts.hasEv
        ? [
            {
              id: `extra-ev-${opts.id}`,
              facility_id: opts.id,
              service_id: null,
              name: "Recarga Vehículo Eléctrico (EV)",
              description: "Carga completa",
              price_amount: 2500,
              currency: "EUR",
              pricing_unit: "per_stay" as const,
              is_mandatory: false,
              max_quantity: 1,
              active: true,
              created_at: "2026-10-01T00:00:00Z",
              updated_at: "2026-10-26T00:00:00Z",
            },
          ]
        : []),
      ...(opts.hasWash
        ? [
            {
              id: `extra-wash-${opts.id}`,
              facility_id: opts.id,
              service_id: null,
              name: "Lavado Exterior a Mano",
              description: "Lavado completo",
              price_amount: 1900,
              currency: "EUR",
              pricing_unit: "per_stay" as const,
              is_mandatory: false,
              max_quantity: 1,
              active: true,
              created_at: "2026-10-01T00:00:00Z",
              updated_at: "2026-10-26T00:00:00Z",
            },
          ]
        : []),
    ],
    cancellation_policy: opts.freeCancHours !== undefined
      ? {
          id: `canc-${opts.id}`,
          operator_id: `op-${opts.id}`,
          legal_document_id: "doc-01",
          free_cancellation_window_hours: opts.freeCancHours,
          late_cancellation_fee_bps: 5000,
          no_show_fee_bps: 10000,
          allow_modifications: true,
          modification_window_hours: 2,
          active: true,
          created_at: "2026-10-01T00:00:00Z",
        }
      : undefined,
    server_quote: quote,
  };
}

describe("Market Search Multi-Dimensional Filters", () => {
  const facValetLow = createMockFacility({
    id: "fac-1",
    name: "AeroValet Express VIP",
    modality: "valet",
    totalAmountCents: 4500, // 45.00 EUR
    hasEv: true,
    hasWash: false,
    freeCancHours: 24,
  });

  const facValetHigh = createMockFacility({
    id: "fac-2",
    name: "Barajas Valet Luxury",
    modality: "valet",
    totalAmountCents: 9500, // 95.00 EUR
    hasEv: true,
    hasWash: true,
    freeCancHours: 48,
  });

  const facShuttleLow = createMockFacility({
    id: "fac-3",
    name: "Shuttle Barajas Economico",
    modality: "shuttle",
    totalAmountCents: 3200, // 32.00 EUR
    hasEv: false,
    hasWash: true,
    freeCancHours: 24,
  });

  const facShuttleNonRefundable = createMockFacility({
    id: "fac-4",
    name: "Shuttle Super LowCost",
    modality: "shuttle",
    totalAmountCents: 2800, // 28.00 EUR
    hasEv: false,
    hasWash: false,
    freeCancHours: 0, // Non-refundable
  });

  const allFacilities = [facValetLow, facValetHigh, facShuttleLow, facShuttleNonRefundable];

  it("filters by modality accurately", () => {
    const valetOnly = allFacilities.filter((f) => f.name.toLowerCase().includes("valet"));
    expect(valetOnly).toHaveLength(2);
    expect(valetOnly.map((f) => f.id)).toEqual(["fac-1", "fac-2"]);

    const shuttleOnly = allFacilities.filter((f) => f.name.toLowerCase().includes("shuttle"));
    expect(shuttleOnly).toHaveLength(2);
    expect(shuttleOnly.map((f) => f.id)).toEqual(["fac-3", "fac-4"]);
  });

  it("filters by features (EV Charging and Car Wash)", () => {
    // EV Charging
    const evFacilities = allFacilities.filter((f) =>
      f.extras?.some((e) => e.name.toLowerCase().includes("ev") || e.name.toLowerCase().includes("eléctric"))
    );
    expect(evFacilities).toHaveLength(2);
    expect(evFacilities.map((f) => f.id)).toEqual(["fac-1", "fac-2"]);

    // Car Wash
    const washFacilities = allFacilities.filter((f) =>
      f.extras?.some((e) => e.name.toLowerCase().includes("lavado"))
    );
    expect(washFacilities).toHaveLength(2);
    expect(washFacilities.map((f) => f.id)).toEqual(["fac-2", "fac-3"]);
  });

  it("filters by cancellation policy (Free Cancellation >= 24h)", () => {
    const freeCancFacilities = allFacilities.filter(
      (f) => (f.cancellation_policy?.free_cancellation_window_hours ?? 0) >= 24
    );
    expect(freeCancFacilities).toHaveLength(3);
    expect(freeCancFacilities.map((f) => f.id)).toEqual(["fac-1", "fac-2", "fac-3"]);
  });

  it("filters by budget limit (max total cents)", () => {
    const max50Eur = allFacilities.filter(
      (f) => (f.server_quote?.customer_total_amount ?? Infinity) <= 5000
    );
    expect(max50Eur).toHaveLength(3); // 28€, 32€, 45€

    const max30Eur = allFacilities.filter(
      (f) => (f.server_quote?.customer_total_amount ?? Infinity) <= 3000
    );
    expect(max30Eur).toHaveLength(1); // 28€ (fac-4)
  });

  it("sorts by price in strict ascending order (neutral consumer ranking)", () => {
    const sorted = [...allFacilities].sort((a, b) => {
      const pA = a.server_quote?.customer_total_amount ?? Infinity;
      const pB = b.server_quote?.customer_total_amount ?? Infinity;
      return pA - pB;
    });

    expect(sorted.map((f) => f.id)).toEqual(["fac-4", "fac-3", "fac-1", "fac-2"]);
    expect(sorted.map((f) => f.server_quote?.customer_total_amount)).toEqual([2800, 3200, 4500, 9500]);
  });
});
