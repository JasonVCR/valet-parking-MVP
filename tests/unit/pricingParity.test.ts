import { describe, it, expect } from "vitest";
import { calculateQuote } from "@/lib/pricing/engine";
import { getCatalogFacilitiesWithQuotes, SYNTHETIC_DEMO_CATALOG } from "@/server/discovery/catalog";

/**
 * Pricing Parity Tests:
 * Verify that the same pricing engine produces identical results
 * when called from the search flow vs. when called directly for booking,
 * and that TypeScript and SQL rounding logic produce identical commissions.
 */
describe("Pricing Parity: Search vs Direct Engine & TypeScript vs SQL Logic", () => {
  const MAD_ID = "a0000000-0000-4000-a000-000000000001";
  const entryAt = "2026-11-01T10:00:00Z";
  const exitAt3d = "2026-11-04T10:00:00Z"; // 72 hours (3 days)

  it("guarantees 100% price parity between Search Quote and direct calculateQuote for the same service", () => {
    // 1. Search quote via getCatalogFacilitiesWithQuotes
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(MAD_ID, entryAt, exitAt3d);
    const demoValet = verifiedFacilities.find((f) => f.id === "demo-fac-valet-01");
    expect(demoValet).toBeDefined();

    const searchQuote = demoValet!.server_quote!;
    expect(searchQuote.customer_total_amount).toBe(5199); // 4200 + 800 + 199

    // 2. Direct engine quote using the same catalog data (simulating booking hold path)
    const catalogEntry = SYNTHETIC_DEMO_CATALOG.find(
      (e) => e.facility.id === "demo-fac-valet-01"
    )!;
    const service = catalogEntry.facility.services[0];

    const directQuote = calculateQuote({
      serviceId: service.id,
      serviceName: service.name,
      basePriceAmount: service.price_amount,
      currency: service.currency,
      pricingUnit: service.pricing_unit,
      entryAt,
      exitAt: exitAt3d,
      tariffBands: catalogEntry.tariffBands,
      availableExtras: catalogEntry.extras,
    });

    // Prices MUST be identical
    expect(directQuote.supplier_base_amount).toBe(searchQuote.supplier_base_amount);
    expect(directQuote.platform_markup_amount).toBe(searchQuote.platform_markup_amount);
    expect(directQuote.booking_management_fee_amount).toBe(searchQuote.booking_management_fee_amount);
    expect(directQuote.extras_amount).toBe(searchQuote.extras_amount);
    expect(directQuote.customer_total_amount).toBe(searchQuote.customer_total_amount);
    expect(directQuote.calculation_version).toBe(3);
  });

  it("guarantees price parity when extras are selected", () => {
    const catalogEntry = SYNTHETIC_DEMO_CATALOG.find(
      (e) => e.facility.id === "demo-fac-valet-01"
    )!;
    const service = catalogEntry.facility.services[0];
    const washExtraId = catalogEntry.extras[0].id; // demo-ext-01-wash

    const quoteWithExtras = calculateQuote({
      serviceId: service.id,
      serviceName: service.name,
      basePriceAmount: service.price_amount,
      currency: service.currency,
      pricingUnit: service.pricing_unit,
      entryAt,
      exitAt: exitAt3d,
      tariffBands: catalogEntry.tariffBands,
      availableExtras: catalogEntry.extras,
      selectedExtras: [{ extra_id: washExtraId, quantity: 1 }],
    });

    // 4200 (base) + 800 (markup) + 199 (fee) + 1800 (wash extra) = 6999 céntimos
    expect(quoteWithExtras.supplier_base_amount).toBe(4200);
    expect(quoteWithExtras.extras_amount).toBe(1800);
    expect(quoteWithExtras.customer_total_amount).toBe(4200 + 800 + 199 + 1800);
    expect(quoteWithExtras.selected_extras).toHaveLength(1);
    expect(quoteWithExtras.selected_extras[0].extra_id).toBe(washExtraId);

    // Breakdown sum invariant
    const breakdownSum = quoteWithExtras.breakdown.reduce((s, item) => s + item.total_price, 0);
    expect(breakdownSum).toBe(quoteWithExtras.customer_total_amount);
  });

  it("guarantees parity between shuttle and valet operators from same catalog query", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(MAD_ID, entryAt, exitAt3d);

    const shuttle = verifiedFacilities.find((f) => f.id === "demo-fac-shuttle-02");
    const valet = verifiedFacilities.find((f) => f.id === "demo-fac-valet-01");

    expect(shuttle).toBeDefined();
    expect(valet).toBeDefined();

    // Shuttle: 3200 + 800 + 199 = 4199
    expect(shuttle!.server_quote!.customer_total_amount).toBe(4199);
    // Valet: 4200 + 800 + 199 = 5199
    expect(valet!.server_quote!.customer_total_amount).toBe(5199);

    // Both must have V3 calculation
    expect(shuttle!.server_quote!.calculation_version).toBe(3);
    expect(valet!.server_quote!.calculation_version).toBe(3);
  });

  describe("SQL vs TypeScript Mathematical Parity (Round Half-Up & Invariants)", () => {
    // Simulates PostgreSQL: round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint
    function simulateSqlCommission(baseAmount: number, commissionRateBps: number): number {
      const val = (baseAmount * commissionRateBps) / 10000.0;
      return Math.round(val);
    }

    it("verifies SQL and TS commission calculations produce identical results for 205 céntimos base", () => {
      const base = 205;
      const rateBps = 1000; // 10%

      const sqlResult = simulateSqlCommission(base, rateBps);
      const tsQuote = calculateQuote({
        serviceId: "srv-parity-test",
        serviceName: "Parity Test",
        basePriceAmount: base,
        currency: "EUR",
        pricingUnit: "per_stay",
        entryAt,
        exitAt: exitAt3d,
        b2bCommissionRateBps: rateBps,
      });

      expect(sqlResult).toBe(21);
      expect(tsQuote.b2b_settlement.commission_amount).toBe(21);
      expect(tsQuote.b2b_settlement.commission_amount).toBe(sqlResult);
      expect(tsQuote.b2b_settlement.operator_payout_amount).toBe(base - sqlResult);
    });

    it("verifies SQL and TS parity across multiple boundary bases", () => {
      const bases = [105, 115, 125, 135, 145, 155, 195, 205, 333, 777, 1001];
      const rateBps = 1000;

      for (const b of bases) {
        const sqlCommission = simulateSqlCommission(b, rateBps);
        const tsQuote = calculateQuote({
          serviceId: "srv-b",
          serviceName: "Test",
          basePriceAmount: b,
          currency: "EUR",
          pricingUnit: "per_stay",
          entryAt,
          exitAt: exitAt3d,
          b2bCommissionRateBps: rateBps,
        });

        expect(tsQuote.b2b_settlement.commission_amount).toBe(sqlCommission);
      }
    });
  });
});
