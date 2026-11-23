import { describe, it, expect, vi } from "vitest";
import { calculateQuote } from "@/lib/pricing/engine";
import { createBookingHoldAction } from "@/server/bookingHolds";
import { getServiceQuoteAction } from "@/server/quotes";
import { SYNTHETIC_DEMO_CATALOG } from "@/data/demoCatalog";
import type { ServicePriceRule } from "@/types/domain";

describe("Increment 8: Transactional Integrity & Unified Quote", () => {
  const MAD_ID = "a0000000-0000-4000-a000-000000000001";
  const entryAt = "2026-11-25T10:00:00Z";
  const exitAt2d = "2026-11-27T10:00:00Z"; // 48 hours

  const demoEntry = SYNTHETIC_DEMO_CATALOG.find((e) => e.facility.id === "demo-fac-valet-01")!;
  const service = demoEntry.facility.services[0];

  describe("1. Atomic Expected Price Validation (Discrepancy Prevention)", () => {
    it("rejects booking hold when expected_total_amount does not match calculated quote", async () => {
      // Calculate real quote first
      const quote = calculateQuote({
        serviceId: service.id,
        serviceName: service.name,
        basePriceAmount: service.price_amount,
        currency: service.currency,
        pricingUnit: service.pricing_unit,
        entryAt,
        exitAt: exitAt2d,
        tariffBands: demoEntry.tariffBands,
        availableExtras: demoEntry.extras,
      });

      const actualPrice = quote.customer_total_amount;
      const wrongExpectedPrice = actualPrice - 500; // 5 EUR discrepancy

      const res = await createBookingHoldAction({
        facility_id: demoEntry.facility.id,
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
        guest_name: "Discrepancy Tester",
        guest_email: "discrepancy@aerovalet.demo",
        expected_total_amount: wrongExpectedPrice,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe("PRICE_DISCREPANCY");
      expect(res.hold).toBeUndefined();
      expect(res.error).toContain("El precio de la reserva ha cambiado");
    });

    it("creates booking hold when expected_total_amount matches calculated quote exactly", async () => {
      const quote = calculateQuote({
        serviceId: service.id,
        serviceName: service.name,
        basePriceAmount: service.price_amount,
        currency: service.currency,
        pricingUnit: service.pricing_unit,
        entryAt,
        exitAt: exitAt2d,
        tariffBands: demoEntry.tariffBands,
        availableExtras: demoEntry.extras,
      });

      const actualPrice = quote.customer_total_amount;

      const res = await createBookingHoldAction({
        facility_id: demoEntry.facility.id,
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
        guest_name: "Matching Tester",
        guest_email: "matching@aerovalet.demo",
        expected_total_amount: actualPrice,
      });

      expect(res.success).toBe(true);
      expect(res.hold).toBeDefined();
      expect(res.hold!.price_amount).toBe(actualPrice);
      expect(res.hold!.status).toBe("active");
    });
  });

  describe("2. Round Half-Up Policy on Percentage Rules with Fractional Cents", () => {
    // Simulates PostgreSQL: round((price * (10000 + bps)::numeric) / 10000.0)::bigint
    function simulateSqlPercentageRule(baseUnitPrice: number, bps: number): number {
      return Math.round((baseUnitPrice * (10000 + bps)) / 10000);
    }

    it("verifies Half-Up rounding for 2050 cents + 100 bps (+1.00%): 2070.5 -> 2071 cents", () => {
      const rule: ServicePriceRule = {
        id: "rule-halfup-1",
        service_id: "srv-fractional",
        name: "Recargo 1%",
        rule_type: "season",
        priority: 10,
        adjustment_type: "percentage_bps",
        percentage_bps: 100, // +1.00%
        fixed_amount: null,
        active: true,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        serviceId: "srv-fractional",
        serviceName: "Fractional Service",
        basePriceAmount: 2050,
        currency: "EUR",
        pricingUnit: "per_stay",
        entryAt,
        exitAt: exitAt2d,
        rules: [rule],
      });

      const expectedAdjusted = simulateSqlPercentageRule(2050, 100);
      expect(expectedAdjusted).toBe(2071);
      expect(quote.supplier_base_amount).toBe(2071);
      expect(quote.applied_rules[0].adjusted_unit_price).toBe(2071);
    });

    it("verifies Half-Up rounding for 2005 cents + 250 bps (+2.50%): 2055.125 -> 2055 cents", () => {
      const rule: ServicePriceRule = {
        id: "rule-halfup-2",
        service_id: "srv-fractional-2",
        name: "Recargo 2.5%",
        rule_type: "season",
        priority: 10,
        adjustment_type: "percentage_bps",
        percentage_bps: 250, // +2.50%
        fixed_amount: null,
        active: true,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        serviceId: "srv-fractional-2",
        serviceName: "Fractional Service 2",
        basePriceAmount: 2005,
        currency: "EUR",
        pricingUnit: "per_stay",
        entryAt,
        exitAt: exitAt2d,
        rules: [rule],
      });

      const expectedAdjusted = simulateSqlPercentageRule(2005, 250);
      expect(expectedAdjusted).toBe(2055);
      expect(quote.supplier_base_amount).toBe(2055);
    });

    it("verifies Half-Up rounding for 2001 cents + 333 bps (+3.33%): 2067.6333 -> 2068 cents", () => {
      const rule: ServicePriceRule = {
        id: "rule-halfup-3",
        service_id: "srv-fractional-3",
        name: "Recargo 3.33%",
        rule_type: "season",
        priority: 10,
        adjustment_type: "percentage_bps",
        percentage_bps: 333,
        fixed_amount: null,
        active: true,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        serviceId: "srv-fractional-3",
        serviceName: "Fractional Service 3",
        basePriceAmount: 2001,
        currency: "EUR",
        pricingUnit: "per_stay",
        entryAt,
        exitAt: exitAt2d,
        rules: [rule],
      });

      const expectedAdjusted = simulateSqlPercentageRule(2001, 333);
      expect(expectedAdjusted).toBe(2068);
      expect(quote.supplier_base_amount).toBe(2068);
    });

    it("verifies Half-Up rounding for discount rule -333 bps (-3.33%) on 2001 cents: 1934.3667 -> 1934 cents", () => {
      const rule: ServicePriceRule = {
        id: "rule-halfup-4",
        service_id: "srv-fractional-4",
        name: "Descuento 3.33%",
        rule_type: "season",
        priority: 10,
        adjustment_type: "percentage_bps",
        percentage_bps: -333,
        fixed_amount: null,
        active: true,
        valid_from: null,
        valid_until: null,
        weekdays: null,
        entry_time_start: null,
        entry_time_end: null,
        min_duration_hours: null,
        max_duration_hours: null,
        vehicle_category: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      };

      const quote = calculateQuote({
        serviceId: "srv-fractional-4",
        serviceName: "Fractional Service 4",
        basePriceAmount: 2001,
        currency: "EUR",
        pricingUnit: "per_stay",
        entryAt,
        exitAt: exitAt2d,
        rules: [rule],
      });

      const expectedAdjusted = simulateSqlPercentageRule(2001, -333);
      expect(expectedAdjusted).toBe(1934);
      expect(quote.supplier_base_amount).toBe(1934);
    });
  });

  describe("3. Unified Quote Server Action (getServiceQuoteAction)", () => {
    it("returns authoritative quote with breakdown in demo mode", async () => {
      const res = await getServiceQuoteAction({
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
      });

      expect(res.success).toBe(true);
      expect(res.quote).toBeDefined();
      expect(res.quote!.customer_total_amount).toBeGreaterThan(0);
      expect(res.quote!.breakdown.length).toBeGreaterThanOrEqual(3); // base + markup + fee
      expect(res.quote!.calculation_version).toBe(3);
    });

    it("recalculates total and breakdown when extras are provided", async () => {
      const extraId = demoEntry.extras[0].id;
      const extraPrice = demoEntry.extras[0].price_amount;

      const baseRes = await getServiceQuoteAction({
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
        selected_extras: [],
      });

      const extraRes = await getServiceQuoteAction({
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
        selected_extras: [{ extra_id: extraId, quantity: 1 }],
      });

      expect(baseRes.success).toBe(true);
      expect(extraRes.success).toBe(true);
      expect(extraRes.quote!.customer_total_amount).toBe(
        baseRes.quote!.customer_total_amount + extraPrice
      );
      expect(extraRes.quote!.extras_amount).toBe(extraPrice);
    });

    it("returns error response cleanly when service does not exist", async () => {
      const res = await getServiceQuoteAction({
        service_id: "00000000-0000-0000-0000-000000000000",
        entry_at: entryAt,
        exit_at: exitAt2d,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe("SERVICE_NOT_FOUND");
      expect(res.quote).toBeUndefined();
    });
  });

  describe("4. Price Parity across Search, Detail, and Hold", () => {
    it("guarantees search quote customer_total_amount equals booking hold price_amount", async () => {
      const quoteRes = await getServiceQuoteAction({
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
      });

      const authorizedTotal = quoteRes.quote!.customer_total_amount;

      const holdRes = await createBookingHoldAction({
        facility_id: demoEntry.facility.id,
        service_id: service.id,
        entry_at: entryAt,
        exit_at: exitAt2d,
        guest_name: "Parity Check",
        guest_email: "parity@aerovalet.demo",
        expected_total_amount: authorizedTotal,
      });

      expect(holdRes.success).toBe(true);
      expect(holdRes.hold!.price_amount).toBe(authorizedTotal);
      const snapshot = holdRes.hold!.price_snapshot;
      if (snapshot && "customer_total_amount" in snapshot) {
        expect(snapshot.customer_total_amount).toBe(authorizedTotal);
      } else {
        expect(snapshot?.total_amount).toBe(authorizedTotal);
      }
    });
  });
});
