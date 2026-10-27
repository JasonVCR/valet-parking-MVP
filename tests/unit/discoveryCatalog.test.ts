import { describe, it, expect } from "vitest";
import {
  getCatalogFacilitiesWithQuotes,
  VERIFIED_DISCOVERED_CATALOG,
} from "@/server/discovery/catalog";

describe("Market Discovery Catalog & Tariff Registry (src/server/discovery/catalog.ts)", () => {
  const MAD_ID = "a0000000-0000-4000-a000-000000000001";
  const entryAt = "2026-11-01T10:00:00Z";
  const exitAt3d = "2026-11-04T10:00:00Z"; // 72 hours (3 days)

  it("exports verified catalog with at least 3 discovered operators", () => {
    expect(VERIFIED_DISCOVERED_CATALOG.length).toBeGreaterThanOrEqual(3);

    const published = VERIFIED_DISCOVERED_CATALOG.filter((e) => e.hasPublishedTariff);
    const manual = VERIFIED_DISCOVERED_CATALOG.filter((e) => !e.hasPublishedTariff);

    expect(published.length).toBeGreaterThanOrEqual(2);
    expect(manual.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates authoritative quotes for verified operators in Madrid-Barajas", () => {
    const { verifiedFacilities, manualConsultationFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    expect(verifiedFacilities.length).toBe(2);
    expect(manualConsultationFacilities.length).toBe(1);

    // Each verified facility must have a server_quote V3
    for (const f of verifiedFacilities) {
      expect(f.server_quote).toBeDefined();
      expect(f.server_quote?.calculation_version).toBe(3);
      expect(f.server_quote?.platform_markup_amount).toBe(800);
      expect(f.server_quote?.booking_management_fee_amount).toBe(199);
      expect(f.cancellation_policy).toBeDefined();
    }
  });

  it("correctly identifies and separates manual consultation operators without invented rates", () => {
    const { manualConsultationFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    expect(manualConsultationFacilities.length).toBe(1);
    const manualOp = manualConsultationFacilities[0];

    expect(manualOp.name).toContain("Iberpark");
    expect(manualOp.server_quote).toBeNull();
    expect(manualOp.extras).toEqual([]);
    expect(manualOp.tariff_bands).toEqual([]);
  });

  it("applies fixed 3-day weekend band for Valet Barajas Express", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    const valetOp = verifiedFacilities.find((f) => f.id === "fac-mad-valet-01");
    expect(valetOp).toBeDefined();

    // In catalog: 3-day band is 4200 céntimos (42.00 EUR flat)
    // Customer total = 4200 + 800 (markup) + 199 (fee) = 5199 céntimos
    expect(valetOp?.server_quote?.supplier_base_amount).toBe(4200);
    expect(valetOp?.server_quote?.customer_total_amount).toBe(5199);

    // Provenance details
    expect(valetOp?.server_quote?.tariff_source?.source_type).toBe("official_website");
    expect(valetOp?.server_quote?.tariff_source?.source_url).toContain("valetbarajas.es");
  });

  it("applies fixed 3-day band for Aeropark Shuttle Barajas", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    const shuttleOp = verifiedFacilities.find((f) => f.id === "fac-mad-shuttle-02");
    expect(shuttleOp).toBeDefined();

    // In catalog: 3-day band is 3200 céntimos (32.00 EUR flat)
    // Customer total = 3200 + 800 + 199 = 4199 céntimos
    expect(shuttleOp?.server_quote?.supplier_base_amount).toBe(3200);
    expect(shuttleOp?.server_quote?.customer_total_amount).toBe(4199);
  });

  it("sorts verified facilities in ascending order of customer_total_amount (neutral ranking)", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    expect(verifiedFacilities.length).toBeGreaterThanOrEqual(2);
    const firstPrice = verifiedFacilities[0].server_quote?.customer_total_amount ?? 0;
    const secondPrice = verifiedFacilities[1].server_quote?.customer_total_amount ?? 0;

    // Aeropark Shuttle (4199) should be first, Valet Barajas Express (5199) second
    expect(firstPrice).toBeLessThan(secondPrice);
    expect(firstPrice).toBe(4199);
    expect(secondPrice).toBe(5199);
  });

  it("includes operator-specific cancellation policy rules", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    const valet = verifiedFacilities.find((f) => f.id === "fac-mad-valet-01");
    const shuttle = verifiedFacilities.find((f) => f.id === "fac-mad-shuttle-02");

    expect(valet?.cancellation_policy?.free_cancellation_window_hours).toBe(24);
    expect(shuttle?.cancellation_policy?.free_cancellation_window_hours).toBe(12);
  });
});
