/**
 * Unit Tests for AeroValet Market Discovery & Tariff Acquisition Engine.
 */

import { describe, it, expect } from "vitest";
import {
  TARGET_AIRPORTS,
  computeContentHash,
  validateRobotsRules,
  isDuplicateOperator,
  importTariffCsv,
  importTariffJsonFeed,
  runMarketIngestionPipeline,
  TestCuratedCatalogProvider,
  createSearchProvider,
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

  describe("Robots.txt compliance validation with mature rules", () => {
    const sampleRobotsTxt = `
User-agent: *
Disallow: /admin/
Disallow: /checkout/
Disallow: /private/
Crawl-delay: 2

User-agent: AeroValetBot
Disallow: /internal/
Allow: /checkout/public-tariffs
Crawl-delay: 1
`;

    it("permits crawling public tariff pages", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/tarifas-parking");
      expect(res.allowed).toBe(true);
      expect(res.crawlDelayMs).toBe(1000); // respects AeroValetBot block
    });

    it("allows explicitly allowed subpath even if parent matches", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/checkout/public-tariffs");
      expect(res.allowed).toBe(true);
    });

    it("strictly forbids crawling private or disallowed paths", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/admin/dashboard");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Disallow: /admin/");
    });

    it("respects specific agent disallow rules", () => {
      const res = validateRobotsRules(sampleRobotsTxt, "/internal/status");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Disallow: /internal/");
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

  describe("RFC 4180 CSV Tariff Import & Error Reporting", () => {
    const validCsv = `
operator_name,operator_slug,airport_iata,modality,address,source_url,band_name,min_hours,max_hours,price_eur,pricing_unit,ev_charging,car_wash,covered,free_canc_hours
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,1 Dia,0,24,20.00,flat_stay,verified,verified,verified,24
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,2 Dias,25,48,35.00,flat_stay,verified,verified,verified,24
Valet Barajas Test,valet-barajas-test,MAD,valet,Terminal T1-T4,https://test.es/tarifas,Semana,49,168,75.00,flat_stay,verified,verified,verified,24
`.trim();

    it("imports CSV rows into structured facility and duration bands without auto-verifying", () => {
      const { validRecords, errors } = importTariffCsv(validCsv);
      expect(errors).toHaveLength(0);
      expect(validRecords).toHaveLength(1);

      const fac = validRecords[0];
      expect(fac.operatorName).toBe("Valet Barajas Test");
      expect(fac.airportIata).toBe("MAD");
      expect(fac.modality).toBe("valet");
      expect(fac.tariffBands).toHaveLength(3);

      expect(fac.tariffBands[0]).toEqual({
        name: "1 Dia",
        minDurationHours: 0,
        maxDurationHours: 24,
        priceAmount: 2000,
        currency: "EUR",
        pricingUnit: "flat_stay",
        evidenceSnippet: "Línea CSV 1: 0h-24h @ 20 EUR",
      });

      expect(fac.features.evCharging).toBe("verified");
      expect(fac.features.carWash).toBe("verified");
      // CSV imports must default to pending_review until verified
      expect(fac.verificationStatus).toBe("pending_review");
    });

    it("returns per-row errors instead of throwing or silently omitting rows", () => {
      const flawedCsv = `
operator_name,operator_slug,airport_iata,modality,address,source_url,band_name,min_hours,max_hours,price_eur,pricing_unit
Op Good,op-good,MAD,valet,Aeropuerto,https://op.es,1d,0,24,20.00,flat_stay
,op-bad,MAD,valet,Aeropuerto,https://op.es,1d,0,24,20.00,flat_stay
Op Good,op-good,INVALID,valet,Aeropuerto,https://op.es,1d,0,24,20.00,flat_stay
Op Good,op-good,MAD,valet,Aeropuerto,https://op.es,1d,-5,24,20.00,flat_stay
Op Good,op-good,MAD,valet,Aeropuerto,https://op.es,1d,24,10,20.00,flat_stay
Op Good,op-good,MAD,valet,Aeropuerto,https://op.es,1d,0,24,-10.00,flat_stay
`.trim();

      const { validRecords, errors } = importTariffCsv(flawedCsv);
      expect(validRecords).toHaveLength(1);
      expect(validRecords[0].tariffBands).toHaveLength(1);
      expect(errors.length).toBe(5);
      expect(errors[0].error).toContain("El nombre del operador no puede estar vacío");
      expect(errors[1].error).toContain("Código de aeropuerto IATA inválido");
      expect(errors[2].error).toContain("min_hours debe ser un entero no negativo");
      expect(errors[3].error).toContain("estrictamente mayor que min_hours");
      expect(errors[4].error).toContain("price_eur debe ser un número positivo");
    });
  });

  describe("Zod-Validated JSON Feed Importer", () => {
    it("successfully validates and imports a compliant operator JSON feed", () => {
      const feedJson = JSON.stringify({
        version: "1.0",
        operator: {
          name: "Direct Operator Valet",
          slug: "direct-operator-valet",
          airportIata: "BCN",
          modality: "valet",
          address: "Terminal 1 Salidas BCN",
          sourceUrl: "https://directvalet.example/feed.json",
        },
        features: {
          evCharging: "verified",
          carWash: "not_available",
          covered: "verified",
          cctv24h: "verified",
        },
        cancellationPolicy: {
          freeCancellationWindowHours: 24,
          lateCancellationFeeBps: 5000,
        },
        tariffBands: [
          {
            name: "Tramo 1 Día",
            minDurationHours: 0,
            maxDurationHours: 24,
            priceAmountCents: 2500,
            currency: "EUR",
            pricingUnit: "flat_stay",
            evidenceSnippet: "Feed oficial API v1.0",
          },
        ],
      });

      const rec = importTariffJsonFeed(feedJson);
      expect(rec.operatorName).toBe("Direct Operator Valet");
      expect(rec.airportIata).toBe("BCN");
      expect(rec.features.evCharging).toBe("verified");
      expect(rec.features.carWash).toBe("not_available");
      expect(rec.tariffBands[0].priceAmount).toBe(2500);
      expect(rec.verificationStatus).toBe("verified");
    });

    it("rejects invalid JSON feeds missing required fields", () => {
      const badFeed = JSON.stringify({
        version: "1.0",
        operator: { name: "X" }, // slug missing, invalid name length
      });
      expect(() => importTariffJsonFeed(badFeed)).toThrow();
    });
  });

  describe("End-to-End Market Ingestion Pipeline", () => {
    it("executes discovery, deduplication, and quality control queue", async () => {
      const result = await runMarketIngestionPipeline(
        TARGET_AIRPORTS.filter((a) => a.iataCode === "MAD"),
        new TestCuratedCatalogProvider()
      );

      expect(result.airportsProcessed).toBe(1);
      expect(result.candidatesDiscovered).toBeGreaterThan(0);

      // Verified operators have published tariff bands AND evidence snippets
      const verified = result.records.filter((r) => r.verificationStatus === "verified");
      expect(verified.length).toBeGreaterThan(0);
      for (const v of verified) {
        expect(v.tariffBands.length).toBeGreaterThan(0);
        expect(v.tariffBands[0].evidenceSnippet).toBeDefined();
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

    it("supports switching providers via factory", () => {
      const provider = createSearchProvider("curated_test");
      expect(provider.name).toBe("TestCuratedCatalogProvider");
    });
  });
});
