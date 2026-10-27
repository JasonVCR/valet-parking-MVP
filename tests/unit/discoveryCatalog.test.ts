import { describe, it, expect } from "vitest";
import {
  getCatalogFacilitiesWithQuotes,
  SYNTHETIC_DEMO_CATALOG,
} from "@/server/discovery/catalog";

describe("Synthetic Demo Catalog & Tariff Provenance (src/server/discovery/catalog.ts)", () => {
  const MAD_ID = "a0000000-0000-4000-a000-000000000001";
  const entryAt = "2026-11-01T10:00:00Z";
  const exitAt3d = "2026-11-04T10:00:00Z"; // 72 hours (3 days)

  it("exports isolated synthetic demo catalog with sandbox transparency tags", () => {
    expect(SYNTHETIC_DEMO_CATALOG.length).toBeGreaterThanOrEqual(3);

    // Every item in demo catalog must be explicitly marked as synthetic fixture
    for (const entry of SYNTHETIC_DEMO_CATALOG) {
      expect(entry.isDemoSynthetic).toBe(true);
      // Sources in demo must be pending_review or sandbox, never unverified 'verified' claims
      expect(entry.tariffSource.verification_status).toBe("pending_review");
      expect(entry.facility.name).toContain("Demo");
    }

    const published = SYNTHETIC_DEMO_CATALOG.filter((e) => e.hasPublishedTariff);
    const manual = SYNTHETIC_DEMO_CATALOG.filter((e) => !e.hasPublishedTariff);

    expect(published.length).toBeGreaterThanOrEqual(2);
    expect(manual.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates authoritative quotes for sandbox demo operators in Madrid-Barajas", () => {
    const { verifiedFacilities, manualConsultationFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    expect(verifiedFacilities.length).toBe(2);
    expect(manualConsultationFacilities.length).toBe(1);

    // Each published facility must have a server_quote V3
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

    expect(manualOp.name).toContain("Consulta Manual");
    expect(manualOp.server_quote).toBeNull();
    expect(manualOp.extras).toEqual([]);
    expect(manualOp.tariff_bands).toEqual([]);
  });

  it("applies fixed 3-day band for AeroValet Demo Valet (5199 céntimos)", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    const valetOp = verifiedFacilities.find((f) => f.id === "demo-fac-valet-01");
    expect(valetOp).toBeDefined();

    // 3-day band is 4200 céntimos (42.00 EUR flat)
    // Customer total = 4200 + 800 (markup) + 199 (fee) = 5199 céntimos
    expect(valetOp?.server_quote?.supplier_base_amount).toBe(4200);
    expect(valetOp?.server_quote?.customer_total_amount).toBe(5199);

    // Provenance details
    expect(valetOp?.server_quote?.tariff_source?.verification_status).toBe("pending_review");
    expect(valetOp?.server_quote?.tariff_source?.source_url).toContain("sandbox.aerovalet.demo");
  });

  it("applies fixed 3-day band for AeroValet Demo Shuttle (4199 céntimos)", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    const shuttleOp = verifiedFacilities.find((f) => f.id === "demo-fac-shuttle-02");
    expect(shuttleOp).toBeDefined();

    // 3-day band is 3200 céntimos (32.00 EUR flat)
    // Customer total = 3200 + 800 + 199 = 4199 céntimos
    expect(shuttleOp?.server_quote?.supplier_base_amount).toBe(3200);
    expect(shuttleOp?.server_quote?.customer_total_amount).toBe(4199);
  });

  it("sorts facilities in ascending order of customer_total_amount (neutral ranking)", () => {
    const { verifiedFacilities } = getCatalogFacilitiesWithQuotes(
      MAD_ID,
      entryAt,
      exitAt3d
    );

    expect(verifiedFacilities.length).toBeGreaterThanOrEqual(2);
    const firstPrice = verifiedFacilities[0].server_quote?.customer_total_amount ?? 0;
    const secondPrice = verifiedFacilities[1].server_quote?.customer_total_amount ?? 0;

    // Demo Shuttle (4199) should be first, Demo Valet (5199) second
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

    const valet = verifiedFacilities.find((f) => f.id === "demo-fac-valet-01");
    const shuttle = verifiedFacilities.find((f) => f.id === "demo-fac-shuttle-02");

    expect(valet?.cancellation_policy?.free_cancellation_window_hours).toBe(24);
    expect(shuttle?.cancellation_policy?.free_cancellation_window_hours).toBe(12);
  });
});
