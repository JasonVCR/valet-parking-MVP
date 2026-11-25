/**
 * Unit Tests for AeroValet Market Discovery & Tariff Acquisition Engine.
 *
 * Validates:
 * - Target airport coverage.
 * - Robots.txt compliance and rate-limiting parsing.
 * - Content hashing with SHA-256 for tariff change detection.
 * - Operator and facility deduplication.
 * - Tabular CSV tariff import and duration band normalization.
 * - Quality control queue (ambiguous / missing tariffs routed to manual consultation).
 */

import { describe, it, expect } from "vitest";
import {
  TARGET_AIRPORTS,
  computeContentHash,
  validateRobotsRules,
  isDuplicateOperator,
  importTariffCsv,
  runMarketIngestionPipeline,
  CuratedMarketCatalogProvider,
} from "@/server/discovery/acquisition";

describe("Market Discovery & Acquisition Engine", () => {
  it("covers major Spanish target airports", () => {
    const codes = TARGET_AIRPORTS.map((a) => a.iataCode);
    expect(codes).toContain("MAD");
    expect(codes).toContain("BCN");
    expect(codes).toContain("AGP");
    expect(codes).toContain("ALC");
    expect(codes).toContain("VLC");
  });

  describe("Robots.txt compliance validation", () => {
    const sampleRobotsTxt = `
User-agent: *
Disallow: /admin/
Disallow: /checkout/
Disallow: /private/
Crawl-delay: 2

User-agent: BadBot
Disallow: /
`;

    it("permits crawling public tariff pages", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/tarifas-parking");
      expect(res.allowed).toBe(true);
      expect(res.crawlDelayMs).toBe(2000);
    });

    it("strictly forbids crawling private or disallowed paths", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/admin/dashboard");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Disallow: /admin/");
    });

    it("respects checkout portal exclusions", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/checkout/payment");
      expect(res.allowed).toBe(false);
    });
  });

  describe("Content hashing and change detection", () => {
    it("computes deterministic 64-character SHA-256 hex hashes", () => {
      const content = "1 dia: 22 EUR, 2 dias: 38 EUR";
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("detects any modification in published tariff text", () => {
      const v1 = "1 dia: 22 EUR, 2 dias: 38 EUR";
      const v2 = "1 dia: 24 EUR, 2 dias: 40 EUR";

      const hashV1 = computeContentHash(v1);
      const hashV2 = computeContentHash(v2);

      expect(hashV1).not.toBe(hashV2);
    });
  });

  describe("Operator & Facility Deduplication", () => {
    it("identifies duplicates sharing identical domains", () => {
      const a = { domain: "aparcamadridvalet.es", companyName: "AparcaMadrid Valet" };
      const b = { domain: "aparcamadridvalet.es", companyName: "Aparca Madrid Aeropuerto" };
      expect(isDuplicateOperator(a, b)).toBe(true);
    });

    it("identifies duplicates by normalized legal name", () => {
      const a = { legalName: "Valet Premium Barajas S.L." };
      const b = { legalName: "VALET PREMIUM BARAJAS, S.L." };
      expect(isDuplicateOperator(a, b)).toBe(true);
    });

    it("identifies duplicates by normalized address proximity", () => {
      const a = { address: "Terminales T1, T2 y T4 - Vía de Salidas, 28042 Madrid" };
      const b = { address: "Terminales T1 T2 y T4 Vía de Salidas 28042 Madrid" };
      expect(isDuplicateOperator(a, b)).toBe(true);
    });

    it("does not falsely flag distinct operators as duplicates", () => {
      const a = { domain: "op-alpha.es", legalName: "Alpha Parking SL", address: "Calle Uno 1" };
      const b = { domain: "op-beta.es", legalName: "Beta Valet SL", address: "Avenida Dos 2" };
      expect(isDuplicateOperator(a, b)).toBe(false);
    });
  });

  describe("CSV Tariff Import & Normalization", () => {
    const validCsv = `
operator_name,operator_slug,airport_iata,modality,address,source_url,band_name,min_hours,max_hours,price_eur,pricing_unit,ev_charging,car_wash,covered,free_canc_hours
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,1 Dia,0,24,20.00,flat_stay,true,true,true,24
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,2 Dias,25,48,35.00,flat_stay,true,true,true,24
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,Semana,49,168,75.00,flat_stay,true,true,true,24
`.trim();

    it("imports CSV rows into structured facility and duration bands", () => {
      const records = importTariffCsv(validCsv);
      expect(records).toHaveLength(1);

      const fac = records[0];
      expect(fac.operatorName).toBe("Valet Barajas Test");
      expect(fac.airportIata).toBe("MAD");
      expect(fac.modality).toBe("valet");
      expect(fac.tariffBands).toHaveLength(3);

      expect(fac.tariffBands[0]).toEqual({
        name: "1 Dia",
        minDurationHours: 0,
        maxDurationHours: 24,
        priceAmount: 2000, // 20.00 EUR in cents
        currency: "EUR",
        pricingUnit: "flat_stay",
      });

      expect(fac.tariffBands[2].priceAmount).toBe(7500); // 75.00 EUR
      expect(fac.features.evCharging).toBe(true);
      expect(fac.features.carWash).toBe(true);
      expect(fac.cancellationPolicy.freeCancellationWindowHours).toBe(24);
      expect(fac.verificationStatus).toBe("verified");
    });

    it("throws clear error on malformed CSV header", () => {
      const invalidCsv = "col1,col2\nval1,val2";
      expect(() => importTariffCsv(invalidCsv)).toThrow(/Columna obligatoria ausente/);
    });
  });

  describe("End-to-End Market Ingestion Pipeline", () => {
    it("executes discovery, deduplication, and quality control queue", async () => {
      const result = await runMarketIngestionPipeline(
        TARGET_AIRPORTS.filter((a) => a.iataCode === "MAD"),
        new CuratedMarketCatalogProvider()
      );

      expect(result.airportsProcessed).toBe(1);
      expect(result.candidatesDiscovered).toBeGreaterThan(0);

      // Verified operators have published tariff bands
      const verified = result.records.filter((r) => r.verificationStatus === "verified");
      expect(verified.length).toBeGreaterThan(0);
      for (const v of verified) {
        expect(v.tariffBands.length).toBeGreaterThan(0);
        expect(v.tariffSource.contentHash).toHaveLength(64);
      }

      // Operators without published rates are routed to manual consultation
      const manual = result.records.filter((r) => r.verificationStatus === "pending_review");
      expect(manual.length).toBeGreaterThan(0);
      for (const m of manual) {
        expect(m.tariffBands).toHaveLength(0);
        expect(m.reviewNotes).toContain("Tarifa bajo consulta");
      }
    });
  });
});
