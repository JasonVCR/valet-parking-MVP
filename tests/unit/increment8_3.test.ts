/**
 * Mandatory Unit & Regression Tests for AeroValet Increment 8.3.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  TARGET_AIRPORTS,
  computeContentHash,
  validateRobotsRules,
  fetchOperatorPageWithCompliance,
  isDuplicateOperator,
  isAmbiguousOperatorMatch,
  runMarketIngestionPipeline,
  createSearchProvider,
  importTariffCsv,
  TestCuratedCatalogProvider,
  OperatorDirectFeedProvider,
  type DiscoveredOperatorCandidate,
} from "@/server/discovery/acquisition";
import {
  filterByModality,
  filterByFeature,
  filterByBudget,
  sortFacilities,
  applyAllSearchFilters,
} from "@/lib/search/filters";
import type { FacilityWithServices, PriceSnapshotV3 } from "@/types/domain";

function buildFacility(opts: {
  id: string;
  name: string;
  modality?: "valet" | "shuttle" | null;
  servicePriceAmount: number;
  serverTotalAmount?: number;
  covered?: "verified" | "not_available" | "unknown";
}): FacilityWithServices {
  const quote: PriceSnapshotV3 | null =
    opts.serverTotalAmount !== undefined
      ? {
          service_id: `srv-${opts.id}`,
          service_name: opts.name,
          currency: "EUR",
          pricing_unit: "per_day",
          duration_hours: 48,
          units: 2,
          supplier_base_amount: opts.serverTotalAmount - 999,
          platform_markup_amount: 800,
          booking_management_fee_amount: 199,
          extras_amount: 0,
          discount_amount: 0,
          tax_amount: 0,
          customer_total_amount: opts.serverTotalAmount,
          total_amount: opts.serverTotalAmount,
          calculation_version: 3,
          applied_rules: [],
          selected_extras: [],
          breakdown: [],
          b2b_settlement: {
            commission_rate_bps: 1000,
            commission_basis_amount: opts.serverTotalAmount - 999,
            commission_amount: 100,
            operator_payout_amount: opts.serverTotalAmount - 999 - 100,
          },
        }
      : null;

  return {
    id: opts.id,
    operator_id: `op-${opts.id}`,
    airport_id: "a0000000-0000-4000-a000-000000000001",
    name: opts.name,
    address: "Terminal T1",
    latitude: null,
    longitude: null,
    total_capacity: 50,
    operational_buffer: 5,
    modality: opts.modality,
    feature_ev_charging: "unknown",
    feature_car_wash: "unknown",
    feature_covered: opts.covered ?? "unknown",
    feature_cctv_24h: "unknown",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    operator: { id: `op-${opts.id}`, name: opts.name, currency: "EUR" },
    services: [
      {
        id: `srv-${opts.id}`,
        facility_id: opts.id,
        name: opts.name,
        description: null,
        price_amount: opts.servicePriceAmount,
        currency: "EUR",
        pricing_unit: "per_day",
        active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    server_quote: quote,
  };
}

describe("Increment 8.3 — Critical Integrity & Acquisition Tests", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalProvider = process.env.MARKET_ACQUISITION_PROVIDER;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    process.env.MARKET_ACQUISITION_PROVIDER = originalProvider;
  });

  it("5. Produces zero invented tariffs for snippet-only candidates", async () => {
    const res = await runMarketIngestionPipeline(
      TARGET_AIRPORTS.filter((a) => a.iataCode === "MAD"),
      new TestCuratedCatalogProvider()
    );

    expect(res.verifiedFacilitiesCount).toBe(0);
    for (const rec of res.records) {
      expect(rec.tariffBands).toHaveLength(0);
      expect(rec.verificationStatus).toBe("pending_review");
    }
  });

  it("6. Content hash varies when downloaded page content changes", async () => {
    const providerA = new OperatorDirectFeedProvider([
      {
        domain: "hashop.es",
        officialUrl: "https://hashop.es/tarifas",
        companyName: "Hash Op",
        airportIata: "MAD",
        modality: "valet",
        address: "Calle Real 10, Madrid",
        hasPublishedTariff: true,
        rawHtmlContent: "<html>1 día 21 EUR</html>",
      },
    ]);
    const providerB = new OperatorDirectFeedProvider([
      {
        domain: "hashop.es",
        officialUrl: "https://hashop.es/tarifas",
        companyName: "Hash Op",
        airportIata: "MAD",
        modality: "valet",
        address: "Calle Real 10, Madrid",
        hasPublishedTariff: true,
        rawHtmlContent: "<html>1 día 25 EUR</html>",
      },
    ]);

    const mad = TARGET_AIRPORTS.filter((a) => a.iataCode === "MAD");
    const r1 = await runMarketIngestionPipeline(mad, providerA);
    const r2 = await runMarketIngestionPipeline(mad, providerB);

    expect(r1.records[0].tariffSource.contentHash).not.toBe(
      r2.records[0].tariffSource.contentHash
    );
    expect(r1.records[0].tariffSource.contentHash).toBe(
      computeContentHash("<html>1 día 21 EUR</html>")
    );
  });

  it("7. Effectively respects robots.txt specificity and blocks disallowed crawl", async () => {
    const robots = `
User-agent: *
Disallow: /tarifas-privadas/
Allow: /tarifas-privadas/publico
Crawl-delay: 1
`;
    expect(validateRobotsRules(robots, "/tarifas-privadas/secreto").allowed).toBe(false);
    expect(validateRobotsRules(robots, "/tarifas-privadas/publico").allowed).toBe(true);

    let pageCalled = false;
    const mockFetch = async (url: string): Promise<Response> => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /tarifas\n", { status: 200 });
      }
      pageCalled = true;
      return new Response("<html>should not be fetched</html>", { status: 200 });
    };

    const fetchResult = await fetchOperatorPageWithCompliance("https://ejemplo-parking.es/tarifas", {
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    });

    expect(fetchResult.fetched).toBe(false);
    expect(fetchResult.blockedByRobots).toBe(true);
    expect(pageCalled).toBe(false);
  });

  it("8. Deduplicates domains even when one source is stored as a full URL", () => {
    expect(
      isDuplicateOperator(
        { domain: "aparcamadridvalet.es", airportIata: "MAD", modality: "valet" },
        { sourceUrl: "https://www.aparcamadridvalet.es/tarifas?ref=1", airportIata: "MAD", modality: "valet" }
      )
    ).toBe(true);
  });

  it("9. Preserves legitimate distinct candidates at the same airport and flags ambiguous ones", async () => {
    const candidates: DiscoveredOperatorCandidate[] = [
      {
        domain: "alpha-valet.es",
        officialUrl: "https://alpha-valet.es/tarifas",
        companyName: "Alpha Valet Madrid",
        airportIata: "MAD",
        modality: "valet",
        address: "Cercanías aeropuerto MAD",
        hasPublishedTariff: false,
      },
      {
        domain: "beta-valet.es",
        officialUrl: "https://beta-valet.es/tarifas",
        companyName: "Beta Valet Madrid",
        airportIata: "MAD",
        modality: "valet",
        address: "Cercanías aeropuerto MAD", // Generic address must NOT cause false duplicate
        hasPublishedTariff: false,
      },
      {
        domain: "alpha-clone.es",
        officialUrl: "https://alpha-clone.es/tarifas",
        companyName: "Alpha Valet Madrid", // Same name, different domain -> flagged ambiguous
        airportIata: "MAD",
        modality: "valet",
        address: "Otra dirección real 123, Madrid",
        hasPublishedTariff: false,
      },
    ];

    const mad = TARGET_AIRPORTS.filter((a) => a.iataCode === "MAD");
    const res = await runMarketIngestionPipeline(mad, new OperatorDirectFeedProvider(candidates));

    expect(res.records).toHaveLength(3);
    expect(res.flaggedAmbiguousCount).toBe(1);
    expect(isAmbiguousOperatorMatch(candidates[0], candidates[2])).toBe(true);
  });

  it("12. Rejects test provider in production and requires explicit real provider", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.MARKET_ACQUISITION_PROVIDER;

    expect(() => createSearchProvider()).toThrow(/PROVIDER_REQUIRED/);
    expect(() => createSearchProvider("curated_test")).toThrow(/TEST_PROVIDER_FORBIDDEN_IN_PRODUCTION/);
    expect(() => createSearchProvider("test")).toThrow(/TEST_PROVIDER_FORBIDDEN_IN_PRODUCTION/);
  });

  it("13 & 14. Search filters & sorting use structured fields and server_quote.customer_total_amount exclusively", () => {
    // Facility A has low services.price_amount (1000) but NO server_quote -> must NOT pass budget filter or sort ahead
    const facNoQuote = buildFacility({
      id: "no-quote",
      name: "Parking Shuttle Económico",
      modality: "valet", // Structured modality overrides name!
      servicePriceAmount: 1000,
      serverTotalAmount: undefined,
      covered: "verified",
    });

    // Facility B has high services.price_amount (9999) but low server_quote (3500)
    const facWithQuoteLow = buildFacility({
      id: "quote-low",
      name: "Parking Barajas",
      modality: "shuttle",
      servicePriceAmount: 9999,
      serverTotalAmount: 3500,
      covered: "verified",
    });

    // Facility C has server_quote 6000
    const facWithQuoteHigh = buildFacility({
      id: "quote-high",
      name: "Parking Premium",
      modality: "valet",
      servicePriceAmount: 1500,
      serverTotalAmount: 6000,
      covered: "unknown",
    });

    const list = [facNoQuote, facWithQuoteHigh, facWithQuoteLow];

    // Structured modality filter
    expect(filterByModality(list, "valet").map((f) => f.id)).toEqual(["no-quote", "quote-high"]);
    expect(filterByModality(list, "shuttle").map((f) => f.id)).toEqual(["quote-low"]);

    // Covered filter
    expect(filterByFeature(list, "covered").map((f) => f.id)).toEqual(["no-quote", "quote-low"]);

    // Budget filter strictly uses server_quote.customer_total_amount
    expect(filterByBudget(list, 5000).map((f) => f.id)).toEqual(["quote-low"]);

    // Sorting strictly uses server_quote.customer_total_amount
    const sorted = sortFacilities(list, "price_asc");
    expect(sorted.map((f) => f.id)).toEqual(["quote-low", "quote-high", "no-quote"]);

    const composite = applyAllSearchFilters(list, {
      modality: "shuttle",
      feature: "covered",
      cancellation: "all",
      maxBudgetCents: 4000,
      sortBy: "price_asc",
    });
    expect(composite.map((f) => f.id)).toEqual(["quote-low"]);
  });

  it("CSV import requires individual evidence to mark features as verified", () => {
    const csvWithoutEvidence = `
operator_name,airport_iata,source_url,min_hours,max_hours,price_eur,ev_charging,covered
Op Sin Evidencia,MAD,https://opsinevidencia.es/tarifas,0,24,20.00,verified,true
`.trim();

    const res = importTariffCsv(csvWithoutEvidence);
    expect(res.errors).toHaveLength(0);
    expect(res.validRecords[0].features.evCharging).toBe("unknown");
    expect(res.validRecords[0].features.covered).toBe("unknown");
  });
});
