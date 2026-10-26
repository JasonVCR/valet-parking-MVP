import { describe, it, expect } from "vitest";
import { calculateQuote } from "@/lib/pricing/engine";
import type { ServicePriceRule, ServiceExtra } from "@/types/domain";

describe("Authoritative Pricing Engine (src/lib/pricing/engine.ts)", () => {
  const baseService = {
    serviceId: "srv-0001",
    serviceName: "Valet Premium T1",
    basePriceAmount: 2000, // 20.00 EUR
    currency: "EUR",
    pricingUnit: "per_day" as const,
  };

  const futureEntry = "2026-11-01T10:00:00Z";
  const futureExit3d = "2026-11-04T10:00:00Z"; // 3 days exactly

  describe("Base calculation without rules", () => {
    it("calculates 3 days base price correctly in integer minor units", () => {
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
      });

      expect(quote.units).toBe(3);
      expect(quote.base_unit_price_amount).toBe(2000);
      expect(quote.base_total_amount).toBe(6000); // 20.00 * 3 = 60.00 EUR
      expect(quote.total_amount).toBe(6000);
      expect(quote.applied_rules).toHaveLength(0);
      expect(quote.breakdown).toHaveLength(1);
      expect(quote.breakdown[0].type).toBe("base_stay");
      expect(quote.calculation_version).toBe(2);
    });

    it("respects per_stay pricing unit", () => {
      const quote = calculateQuote({
        ...baseService,
        pricingUnit: "per_stay",
        entryAt: futureEntry,
        exitAt: futureExit3d,
      });

      expect(quote.units).toBe(1);
      expect(quote.total_amount).toBe(2000);
    });
  });

  describe("Rule adjustments (Priority and Criteria)", () => {
    it("applies fixed override rule (e.g. promotional season)", () => {
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

      expect(quote.units).toBe(3);
      expect(quote.applied_rules).toHaveLength(1);
      expect(quote.applied_rules[0].adjusted_unit_price).toBe(1500);
      expect(quote.total_amount).toBe(4500); // 15.00 * 3
      expect(quote.rules_adjustments_amount).toBe(-1500); // (1500 - 2000) * 3
    });

    it("respects rule priority deterministically when multiple rules match", () => {
      const lowPriorityRule: ServicePriceRule = {
        id: "rule-low",
        service_id: "srv-0001",
        name: "Descuento General",
        rule_type: "duration_band",
        priority: 5,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: 48,
        max_duration_hours: null,
        vehicle_category: null,
        adjustment_type: "override",
        fixed_amount: 1800,
        percentage_bps: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const highPriorityRule: ServicePriceRule = {
        id: "rule-high",
        service_id: "srv-0001",
        name: "Tarifa VIP Festivo",
        rule_type: "season",
        priority: 50,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        adjustment_type: "override",
        fixed_amount: 2500,
        percentage_bps: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
        rules: [lowPriorityRule, highPriorityRule],
      });

      // Priority 50 beats Priority 5
      expect(quote.applied_rules[0].rule_id).toBe("rule-high");
      expect(quote.total_amount).toBe(7500); // 2500 * 3
    });

    it("calculates percentage bps adjustments accurately without float errors", () => {
      const percentageRule: ServicePriceRule = {
        id: "rule-bps",
        service_id: "srv-0001",
        name: "Recargo Alta Demanda +15%",
        rule_type: "season",
        priority: 20,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        adjustment_type: "percentage_bps",
        fixed_amount: null,
        percentage_bps: 1500, // +15%
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
        rules: [percentageRule],
      });

      // 2000 * 1.15 = 2300 per day
      expect(quote.applied_rules[0].adjusted_unit_price).toBe(2300);
      expect(quote.total_amount).toBe(6900); // 2300 * 3 = 69.00 EUR
    });

    it("applies vehicle category filter only to matching vehicle", () => {
      const suvSurchargeRule: ServicePriceRule = {
        id: "rule-suv",
        service_id: "srv-0001",
        name: "Suplemento SUV / Gran Volumen",
        rule_type: "vehicle_category",
        priority: 30,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: "suv",
        adjustment_type: "fixed_addition",
        fixed_amount: 500, // +5.00 EUR / day
        percentage_bps: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      // 1. Standard vehicle -> rule should NOT apply
      const standardQuote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
        vehicleCategory: "standard",
        rules: [suvSurchargeRule],
      });
      expect(standardQuote.applied_rules).toHaveLength(0);
      expect(standardQuote.total_amount).toBe(6000);

      // 2. SUV vehicle -> rule should apply (+500/day = 2500 * 3 = 7500)
      const suvQuote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d,
        vehicleCategory: "suv",
        rules: [suvSurchargeRule],
      });
      expect(suvQuote.applied_rules).toHaveLength(1);
      expect(suvQuote.total_amount).toBe(7500);
    });
  });

  describe("Service Extras calculation", () => {
    const washExtra: ServiceExtra = {
      id: "extra-wash",
      facility_id: "fac-1",
      service_id: null,
      name: "Lavado Completo VIP",
      description: "Lavado exterior a mano y aspirado",
      price_amount: 2500, // 25.00 EUR fixed
      currency: "EUR",
      pricing_unit: "per_stay",
      is_mandatory: false,
      max_quantity: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };

    const evChargingExtra: ServiceExtra = {
      id: "extra-ev",
      facility_id: "fac-1",
      service_id: null,
      name: "Recarga VE Diaria",
      description: "Mantenimiento y carga inteligente",
      price_amount: 600, // 6.00 EUR per day
      currency: "EUR",
      pricing_unit: "per_day",
      is_mandatory: false,
      max_quantity: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };

    const environmentalFee: ServiceExtra = {
      id: "extra-env",
      facility_id: "fac-1",
      service_id: null,
      name: "Tasa Ecológica Aeroportuaria",
      description: "Tasa municipal de emisiones",
      price_amount: 150, // 1.50 EUR per stay mandatory
      currency: "EUR",
      pricing_unit: "per_stay",
      is_mandatory: true,
      max_quantity: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };

    it("automatically includes mandatory extras and accurately computes optional per_stay and per_day extras", () => {
      const quote = calculateQuote({
        ...baseService,
        entryAt: futureEntry,
        exitAt: futureExit3d, // 3 days
        availableExtras: [washExtra, evChargingExtra, environmentalFee],
        selectedExtras: [
          { extra_id: "extra-wash", quantity: 1 },
          { extra_id: "extra-ev", quantity: 1 },
        ],
      });

      // Base: 2000 * 3 = 6000
      // Mandatory: 150 (per_stay) = 150
      // Wash: 2500 (per_stay) = 2500
      // EV: 600 (per_day * 3) = 1800
      // Total Extras = 150 + 2500 + 1800 = 4450
      // Total Amount = 6000 + 4450 = 10450 (104.50 EUR)
      expect(quote.extras_amount).toBe(4450);
      expect(quote.total_amount).toBe(10450);
      expect(quote.selected_extras).toHaveLength(3);
      expect(quote.breakdown).toHaveLength(4); // base + 3 extras
    });
  });

  describe("Validation & Errors", () => {
    it("throws RangeError if duration is less than 30 minutes", () => {
      expect(() =>
        calculateQuote({
          ...baseService,
          entryAt: "2026-11-01T10:00:00Z",
          exitAt: "2026-11-01T10:15:00Z", // 15 mins
        })
      ).toThrow(RangeError);
    });

    it("throws RangeError if exit is before entry", () => {
      expect(() =>
        calculateQuote({
          ...baseService,
          entryAt: "2026-11-04T10:00:00Z",
          exitAt: "2026-11-01T10:00:00Z",
        })
      ).toThrow(RangeError);
    });
  });
});
