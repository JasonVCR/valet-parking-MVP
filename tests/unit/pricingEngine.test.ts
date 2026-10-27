import { describe, it, expect } from "vitest";
import {
  calculateQuote,
  AEROVALET_PLATFORM_MARKUP_AMOUNT,
  AEROVALET_BOOKING_MANAGEMENT_FEE_AMOUNT,
} from "@/lib/pricing/engine";
import type { ServicePriceRule, ServiceExtra, ServiceTariffBand } from "@/types/domain";

describe("Authoritative Pricing Engine V3 (src/lib/pricing/engine.ts)", () => {
  const baseService = {
    serviceId: "srv-0001",
    serviceName: "Valet Premium T1",
    basePriceAmount: 2000, // 20.00 EUR / day
    currency: "EUR",
    pricingUnit: "per_day" as const,
  };

  const futureEntry = "2026-11-01T10:00:00Z";
  const futureExit3d = "2026-11-04T10:00:00Z"; // 3 days exactly (72 hours)

  const fixedFees = AEROVALET_PLATFORM_MARKUP_AMOUNT + AEROVALET_BOOKING_MANAGEMENT_FEE_AMOUNT; // 800 + 199 = 999 céntimos

  describe("Base calculation with explicit AeroValet fees", () => {
    it("calculates 3 days base price + AeroValet fees (800c + 199c)", () => {
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
      });

      expect(quote.units).toBe(3);
      expect(quote.supplier_base_amount).toBe(6000); // 20.00 * 3 = 60.00 EUR
      expect(quote.platform_markup_amount).toBe(800);
      expect(quote.booking_management_fee_amount).toBe(199);
      expect(quote.customer_total_amount).toBe(6000 + fixedFees); // 6999 céntimos = 69.99 EUR
      expect(quote.calculation_version).toBe(3);

      // Verify B2B settlement memo
      expect(quote.b2b_settlement.commission_basis_amount).toBe(6000);
      expect(quote.b2b_settlement.commission_amount).toBe(600); // 10% of 6000 = 600 céntimos
      expect(quote.b2b_settlement.operator_payout_amount).toBe(5400); // 6000 - 600 = 5400 céntimos
    });

    it("respects per_stay pricing unit", () => {
      const quote = calculateQuote({
        ...baseService,
        pricingUnit: "per_stay",
        entryAt: futureEntry,
        exitAt: futureExit3d,
      });

      expect(quote.units).toBe(1);
      expect(quote.supplier_base_amount).toBe(2000);
      expect(quote.customer_total_amount).toBe(2000 + fixedFees);
    });
  });

  describe("Service Tariff Bands (Fixed Duration Tables)", () => {
    const sampleBands: ServiceTariffBand[] = [
      {
        id: "band-1d",
        service_id: "srv-0001",
        source_id: "src-01",
        name: "Tarifa 24h",
        min_duration_hours: 0,
        max_duration_hours: 24,
        price_amount: 2200, // 22.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "band-3d",
        service_id: "srv-0001",
        source_id: "src-01",
        name: "Tarifa Fin de Semana (3 días)",
        min_duration_hours: 25,
        max_duration_hours: 72,
        price_amount: 4500, // 45.00 EUR flat (instead of 3x20 = 60)
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "band-7d",
        service_id: "srv-0001",
        source_id: "src-01",
        name: "Tarifa 1 Semana (7 días)",
        min_duration_hours: 73,
        max_duration_hours: 168,
        price_amount: 7000, // 70.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
    ];

    it("matches exact 3-day tariff band (72 hours) and applies flat stay rate", () => {
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d, // 72h
        tariffBands: sampleBands,
      });

      expect(quote.supplier_base_amount).toBe(4500); // 45.00 EUR flat from band
      expect(quote.customer_total_amount).toBe(4500 + fixedFees); // 4500 + 999 = 5499 (54.99 EUR)
      expect(quote.breakdown[0].type).toBe("supplier_tariff_band");
      expect(quote.breakdown[0].label).toContain("Tarifa Fin de Semana");
    });

    it("matches 24h band for 1-day stays", () => {
      const exit1d = "2026-11-02T10:00:00Z"; // 24h
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: exit1d,
        tariffBands: sampleBands,
      });

      expect(quote.supplier_base_amount).toBe(2200);
      expect(quote.customer_total_amount).toBe(2200 + fixedFees);
    });

    it("handles stay exceeding maximum defined band by prorating additional days", () => {
      // 10 days = 240 hours. Max band is 7 days (168h) = 7000c.
      // Excess = 72 hours = 3 extra days * 2000c/day = 6000c.
      // Expected supplier base = 7000 + 6000 = 13000c (130.00 EUR).
      const exit10d = "2026-11-11T10:00:00Z";
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: exit10d,
        tariffBands: sampleBands,
      });

      expect(quote.supplier_base_amount).toBe(13000);
      expect(quote.customer_total_amount).toBe(13000 + fixedFees);
      expect(quote.breakdown[0].label).toContain("3 d adicionales");
    });
  });

  describe("Dynamic Rules Fallback and Precedence", () => {
    it("applies fixed override rule when no tariff band is present", () => {
      const seasonRule: ServicePriceRule = {
        id: "rule-season",
        service_id: "srv-0001",
        name: "Promo Invierno",
        rule_type: "season",
        priority: 10,
        valid_from: "2026-10-01T00:00:00Z",
        valid_until: "2026-12-31T23:59:59Z",
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        adjustment_type: "override",
        fixed_amount: 1500, // 15.00 EUR override
        percentage_bps: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
        rules: [seasonRule],
      });

      expect(quote.supplier_base_amount).toBe(4500); // 1500 * 3
      expect(quote.customer_total_amount).toBe(4500 + fixedFees);
    });
  });

  describe("Service Extras calculation", () => {
    const washExtra: ServiceExtra = {
      id: "extra-wash",
      facility_id: "fac-1",
      service_id: null,
      name: "Lavado Completo VIP",
      description: "Lavado exterior a mano",
      price_amount: 2500, // 25.00 EUR
      currency: "EUR",
      pricing_unit: "per_stay",
      is_mandatory: false,
      max_quantity: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };

    it("adds extras to customer total without inflating B2B commission on platform markup", () => {
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d, // 6000 base
        availableExtras: [washExtra],
        selectedExtras: [{ extra_id: "extra-wash", quantity: 1 }],
      });

      expect(quote.supplier_base_amount).toBe(6000);
      expect(quote.extras_amount).toBe(2500);
      // Total = 6000 + 800 + 199 + 2500 = 9499
      expect(quote.customer_total_amount).toBe(6000 + fixedFees + 2500);
      expect(quote.b2b_settlement.commission_basis_amount).toBe(6000);
      expect(quote.b2b_settlement.commission_amount).toBe(600); // 10% strictly of 6000
    });
  });
});
