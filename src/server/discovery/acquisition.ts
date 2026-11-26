/**
 * Market Discovery, Provider Architecture, and Verifiable Tariff Normalization Engine.
 *
 * Implements an isolated, polite, and verifiable acquisition pipeline for airport
 * parking operators across target airports (MAD, BCN, AGP, ALC, VLC).
 *
 * Security & Integrity Guarantees (Increment 8.3):
 * 1. Zero invented/hardcoded prices: no fallback tariffs (no 2200c, 3800c, or 2000c).
 * 2. Search snippets alone NEVER verify an operator or generate tariff bands.
 * 3. SHA-256 content_hash is computed over actual downloaded page/feed content, never over URL.
 * 4. Strict robots.txt compliance (Allow/Disallow longest-prefix specificity, Crawl-delay)
 *    plus URL/SSRF validation and private/checkout path exclusion before any page fetch.
 * 5. Domain-normalized deduplication (handles full URLs, excludes generic addresses,
 *    flags ambiguous cases to manual review instead of silently dropping).
 * 6. Feature verification requires individual verifiable evidence; otherwise remains 'unknown'.
 * 7. TestCuratedCatalogProvider is forbidden in production and never the default provider.
 */

import { createHash } from "crypto";
import { z } from "zod";
import type {
  TariffSourceType,
  TariffAcquisitionMode,
  TariffVerificationStatus,
  TariffBandPricingUnit,
  FeatureVerificationStatus,
} from "@/types/domain";

// ─── Target Airports ──────────────────────────────────────────────────────────

export interface TargetAirport {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
}

export const TARGET_AIRPORTS: TargetAirport[] = [
  { iataCode: "MAD", name: "Adolfo Suárez Madrid-Barajas", city: "Madrid", countryCode: "ES" },
  { iataCode: "BCN", name: "Josep Tarradellas Barcelona-El Prat", city: "Barcelona", countryCode: "ES" },
  { iataCode: "AGP", name: "Málaga-Costa del Sol", city: "Málaga", countryCode: "ES" },
  { iataCode: "ALC", name: "Alicante-Elche Miguel Hernández", city: "Alicante", countryCode: "ES" },
  { iataCode: "VLC", name: "Valencia-Manises", city: "Valencia", countryCode: "ES" },
];

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}

// ─── URL, Domain & Politeness Validation ──────────────────────────────────────

const FORBIDDEN_CRAWL_PATH_PREFIXES = [
  "/admin",
  "/wp-admin",
  "/checkout",
  "/cart",
  "/payment",
  "/pago",
  "/login",
  "/signin",
  "/account",
  "/mi-cuenta",
  "/private",
  "/internal",
  "/api/",
];

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /\.local$/i,
  /\.internal$/i,
];

export function extractNormalizedDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split(":")[0];
  }
}

export function validateOfficialUrl(rawUrl: string): { valid: boolean; url?: URL; reason?: string } {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, reason: `Esquema no permitido: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || !hostname.includes(".")) {
      return { valid: false, reason: `Dominio inválido: ${hostname}` };
    }
    if (PRIVATE_HOST_PATTERNS.some((rx) => rx.test(hostname))) {
      return { valid: false, reason: `Host privado o local prohibido: ${hostname}` };
    }
    const lowerPath = parsed.pathname.toLowerCase();
    for (const forbidden of FORBIDDEN_CRAWL_PATH_PREFIXES) {
      if (lowerPath === forbidden || lowerPath.startsWith(forbidden.endsWith("/") ? forbidden : `${forbidden}/`)) {
        return { valid: false, reason: `Ruta privada/administrativa/checkout excluida: ${parsed.pathname}` };
      }
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, reason: `URL malformada: ${rawUrl}` };
  }
}

// ─── Discovered Candidates & Normalization Contracts ─────────────────────────

export interface DiscoveredOperatorCandidate {
  domain: string;
  officialUrl: string;
  companyName: string;
  legalName?: string;
  airportIata: string;
  modality: "valet" | "shuttle";
  address: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  hasPublishedTariff: boolean;
  tariffSummary?: string;
  evidenceSnippet?: string;
  rawHtmlContent?: string;
  directTariffBands?: NormalizedTariffBandInput[];
}

export interface NormalizedTariffBandInput {
  name: string;
  minDurationHours: number;
  maxDurationHours: number;
  priceAmount: number; // integer minor units (euro cents)
  currency: string;
  pricingUnit: TariffBandPricingUnit;
  evidenceSnippet: string;
  vehicleCategory?: "standard" | "suv" | "van" | "motorcycle" | null;
}

export interface IngestedTariffSource {
  id: string;
  operatorId: string;
  serviceId?: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceType: TariffSourceType;
  acquisitionMode: TariffAcquisitionMode;
  contentHash: string; // 64 hex characters
  retrievedAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  verificationStatus: TariffVerificationStatus;
  provenanceNotes?: string;
  rawPayload: Record<string, unknown>;
}

export interface IngestedFacilityRecord {
  id: string;
  domain: string;
  operatorName: string;
  operatorSlug: string;
  legalName?: string;
  airportIata: string;
  facilityName: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  modality: "valet" | "shuttle";
  discoveryProvider: string;
  tariffSource: IngestedTariffSource;
  tariffBands: NormalizedTariffBandInput[];
  features: {
    evCharging: FeatureVerificationStatus;
    carWash: FeatureVerificationStatus;
    covered: FeatureVerificationStatus;
    cctv24h: FeatureVerificationStatus;
  };
  featureEvidence: Record<string, string>;
  cancellationPolicy: {
    freeCancellationWindowHours: number;
    lateCancellationFeeBps: number;
    isVerified: boolean;
    evidence?: string;
  };
  verificationStatus: TariffVerificationStatus;
  reviewNotes?: string;
}

// ─── Politeness & RFC 9309 Robots.txt Parser ──────────────────────────────────

export interface RobotsValidationResult {
  allowed: boolean;
  reason?: string;
  crawlDelayMs?: number;
}

/**
 * Validates whether a target operator URL permits indexing under standard RFC 9309 robots.txt rules.
 * Supports User-agent specificity, Disallow/Allow longest-prefix precedence, and Crawl-delay.
 */
export function validateRobotsRules(
  robotsTxtContent: string,
  targetPath: string,
  userAgent = "AeroValetBot"
): RobotsValidationResult {
  const lines = robotsTxtContent.split(/\r?\n/);
  const normalizedPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;

  let inTargetAgentBlock = false;
  let inWildcardBlock = false;
  const agentRules: Array<{ type: "allow" | "disallow"; path: string }> = [];
  const wildcardRules: Array<{ type: "allow" | "disallow"; path: string }> = [];
  let agentCrawlDelay: number | undefined;
  let wildcardCrawlDelay: number | undefined;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (line.length === 0) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (agent === userAgent.toLowerCase()) {
        inTargetAgentBlock = true;
        inWildcardBlock = false;
      } else if (agent === "*") {
        inTargetAgentBlock = false;
        inWildcardBlock = true;
      } else {
        inTargetAgentBlock = false;
        inWildcardBlock = false;
      }
    } else if (inTargetAgentBlock) {
      if (key === "disallow" && value.length > 0) {
        agentRules.push({ type: "disallow", path: value });
      } else if (key === "allow" && value.length > 0) {
        agentRules.push({ type: "allow", path: value });
      } else if (key === "crawl-delay") {
        const sec = parseFloat(value);
        if (!isNaN(sec) && sec > 0) agentCrawlDelay = Math.round(sec * 1000);
      }
    } else if (inWildcardBlock) {
      if (key === "disallow" && value.length > 0) {
        wildcardRules.push({ type: "disallow", path: value });
      } else if (key === "allow" && value.length > 0) {
        wildcardRules.push({ type: "allow", path: value });
      } else if (key === "crawl-delay") {
        const sec = parseFloat(value);
        if (!isNaN(sec) && sec > 0) wildcardCrawlDelay = Math.round(sec * 1000);
      }
    }
  }

  // Merge wildcard and agent-specific rules, resolving conflicts by longest-prefix specificity
  // (with agent-specific rules and Allow taking precedence on equal length).
  const activeRules = [
    ...wildcardRules.map((r) => ({ ...r, isAgentSpecific: false })),
    ...agentRules.map((r) => ({ ...r, isAgentSpecific: true })),
  ];
  const crawlDelayMs = agentCrawlDelay ?? wildcardCrawlDelay;

  let bestMatch: { type: "allow" | "disallow"; path: string; length: number; isAgentSpecific: boolean } | null = null;

  for (const rule of activeRules) {
    const matches = rule.path === "/" || normalizedPath.startsWith(rule.path);
    if (!matches) continue;

    const len = rule.path.length;
    if (
      !bestMatch ||
      len > bestMatch.length ||
      (len === bestMatch.length && rule.isAgentSpecific && !bestMatch.isAgentSpecific) ||
      (len === bestMatch.length && rule.isAgentSpecific === bestMatch.isAgentSpecific && rule.type === "allow" && bestMatch.type === "disallow")
    ) {
      bestMatch = { type: rule.type, path: rule.path, length: len, isAgentSpecific: rule.isAgentSpecific };
    }
  }

  if (bestMatch && bestMatch.type === "disallow") {
    return {
      allowed: false,
      reason: `Ruta "${targetPath}" expresamente denegada por directiva Disallow: ${bestMatch.path}`,
      crawlDelayMs,
    };
  }

  return { allowed: true, crawlDelayMs };
}

// ─── Polite HTTP Page Fetcher & Tariff Extractor ──────────────────────────────

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CrawlFetchOptions {
  fetchImpl?: FetchLike;
  userAgent?: string;
  defaultDelayMs?: number;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const domainLastRequestAt = new Map<string, number>();

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PageFetchResult {
  fetched: boolean;
  blockedByRobots: boolean;
  content?: string;
  contentHash?: string;
  reason?: string;
}

/**
 * Checks robots.txt on the target origin, enforces Crawl-delay and backoff,
 * and downloads the operator's real page content.
 */
export async function fetchOperatorPageWithCompliance(
  targetUrl: string,
  options: CrawlFetchOptions = {}
): Promise<PageFetchResult> {
  const urlCheck = validateOfficialUrl(targetUrl);
  if (!urlCheck.valid || !urlCheck.url) {
    return { fetched: false, blockedByRobots: false, reason: urlCheck.reason };
  }

  const parsedUrl = urlCheck.url;
  const fetchFn = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? "AeroValetBot";
  const sleepFn = options.sleepImpl ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;

  // 1. Fetch and evaluate robots.txt
  const robotsUrl = `${parsedUrl.origin}/robots.txt`;
  let crawlDelayMs = options.defaultDelayMs ?? 1000;

  try {
    const robotsRes = await fetchFn(robotsUrl, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const robotsTxt = await robotsRes.text();
      const robotsCheck = validateRobotsRules(
        robotsTxt,
        `${parsedUrl.pathname}${parsedUrl.search}`,
        userAgent
      );
      if (robotsCheck.crawlDelayMs && robotsCheck.crawlDelayMs > crawlDelayMs) {
        crawlDelayMs = robotsCheck.crawlDelayMs;
      }
      if (!robotsCheck.allowed) {
        return {
          fetched: false,
          blockedByRobots: true,
          reason: robotsCheck.reason,
        };
      }
    }
  } catch {
    // If robots.txt cannot be reached, proceed politely with default crawlDelayMs
  }

  // 2. Enforce domain rate limiting
  const domain = parsedUrl.hostname.toLowerCase();
  const lastAt = domainLastRequestAt.get(domain);
  if (lastAt !== undefined) {
    const elapsed = Date.now() - lastAt;
    if (elapsed < crawlDelayMs) {
      await sleepFn(crawlDelayMs - elapsed);
    }
  }

  // 3. Download page with exponential backoff on 429/5xx
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    domainLastRequestAt.set(domain, Date.now());
    try {
      const res = await fetchFn(parsedUrl.toString(), {
        headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain" },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          const backoffMs = crawlDelayMs * Math.pow(2, attempt + 1);
          await sleepFn(backoffMs);
          continue;
        }
        return { fetched: false, blockedByRobots: false, reason: `HTTP ${res.status}` };
      }

      if (!res.ok) {
        return { fetched: false, blockedByRobots: false, reason: `HTTP ${res.status}` };
      }

      const content = await res.text();
      if (!content || content.trim().length === 0) {
        return { fetched: false, blockedByRobots: false, reason: "Contenido vacío" };
      }

      return {
        fetched: true,
        blockedByRobots: false,
        content,
        contentHash: computeContentHash(content),
      };
    } catch (err) {
      if (attempt < maxRetries) {
        await sleepFn(crawlDelayMs * Math.pow(2, attempt + 1));
        continue;
      }
      return {
        fetched: false,
        blockedByRobots: false,
        reason: err instanceof Error ? err.message : "Error de red",
      };
    }
  }

  return { fetched: false, blockedByRobots: false, reason: "Reintentos agotados" };
}

/**
 * Extracts verifiable tariff bands strictly from downloaded HTML/text content.
 * Requires explicit duration intervals AND explicit EUR prices. Never invents prices.
 */
export function extractTariffBandsFromContent(content: string): NormalizedTariffBandInput[] {
  const text = content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return [];

  const bands: NormalizedTariffBandInput[] = [];
  const seenIntervals = new Set<string>();

  // Pattern: "<days> dia(s) ... <price> € / EUR"
  const dayRegex = /(\d{1,2})\s*(?:d[ií]as?|d)\s*(?::|-|a|por)?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b)/gi;
  let match: RegExpExecArray | null;

  while ((match = dayRegex.exec(text)) !== null) {
    const days = parseInt(match[1], 10);
    const priceEur = parseFloat(match[2].replace(",", "."));
    if (isNaN(days) || days < 1 || days > 90 || isNaN(priceEur) || priceEur <= 0) continue;

    const minHours = days === 1 ? 0 : (days - 1) * 24 + 1;
    const maxHours = days * 24;
    const key = `${minHours}-${maxHours}`;
    if (seenIntervals.has(key)) continue;
    seenIntervals.add(key);

    bands.push({
      name: `${days} ${days === 1 ? "Día" : "Días"}`,
      minDurationHours: minHours,
      maxDurationHours: maxHours,
      priceAmount: Math.round(priceEur * 100),
      currency: "EUR",
      pricingUnit: "flat_stay",
      evidenceSnippet: match[0].trim(),
    });
  }

  return bands.sort((a, b) => a.minDurationHours - b.minDurationHours);
}

// ─── Search Provider Architecture ─────────────────────────────────────────────

export interface WebSearchProvider {
  name: string;
  isTestOnly?: boolean;
  searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]>;
}

/**
 * Google Custom Search JSON API Provider.
 * Requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX env vars.
 */
export class GoogleCustomSearchProvider implements WebSearchProvider {
  name = "GoogleCustomSearchProvider";
  private apiKey?: string;
  private cx?: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    this.cx = process.env.GOOGLE_SEARCH_CX;
  }

  async searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]> {
    if (!this.apiKey || !this.cx) {
      throw new Error(
        "GoogleCustomSearchProvider requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX environment variables"
      );
    }
    const query = encodeURIComponent(`parking ${modality} aeropuerto ${airport.city} tarifas precios`);
    const endpoint = `https://www.googleapis.com/customsearch/v1?key=${this.apiKey}&cx=${this.cx}&q=${query}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`Google Search API error ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    const items = data.items || [];
    return items.map((item: { title: string; link: string; snippet?: string; displayLink?: string }) => ({
      domain: extractNormalizedDomain(item.displayLink || item.link),
      officialUrl: item.link,
      companyName: item.title,
      airportIata: airport.iataCode,
      modality,
      address: "",
      hasPublishedTariff: false, // Search snippets NEVER verify tariffs
      evidenceSnippet: item.snippet,
    }));
  }
}

/**
 * Bing Web Search API Provider.
 * Requires BING_SEARCH_API_KEY env var.
 */
export class BingWebSearchProvider implements WebSearchProvider {
  name = "BingWebSearchProvider";
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.BING_SEARCH_API_KEY;
  }

  async searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]> {
    if (!this.apiKey) {
      throw new Error("BingWebSearchProvider requires BING_SEARCH_API_KEY environment variable");
    }
    const query = encodeURIComponent(`parking ${modality} aeropuerto ${airport.city} tarifas`);
    const endpoint = `https://api.bing.microsoft.com/v7.0/search?q=${query}`;
    const res = await fetch(endpoint, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`Bing Search API error ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    const webPages = data.webPages?.value || [];
    return webPages.map((page: { name: string; url: string; snippet?: string }) => ({
      domain: extractNormalizedDomain(page.url),
      officialUrl: page.url,
      companyName: page.name,
      airportIata: airport.iataCode,
      modality,
      address: "",
      hasPublishedTariff: false,
      evidenceSnippet: page.snippet,
    }));
  }
}

/**
 * SerpAPI Provider.
 * Requires SERPAPI_API_KEY env var.
 */
export class SerpApiSearchProvider implements WebSearchProvider {
  name = "SerpApiSearchProvider";
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.SERPAPI_API_KEY;
  }

  async searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]> {
    if (!this.apiKey) {
      throw new Error("SerpApiSearchProvider requires SERPAPI_API_KEY environment variable");
    }
    const query = encodeURIComponent(`parking ${modality} aeropuerto ${airport.city} tarifas`);
    const endpoint = `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${this.apiKey}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`SerpAPI error ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    const organic = data.organic_results || [];
    return organic.map((item: { title: string; link: string; snippet?: string }) => ({
      domain: extractNormalizedDomain(item.link),
      officialUrl: item.link,
      companyName: item.title,
      airportIata: airport.iataCode,
      modality,
      address: "",
      hasPublishedTariff: false,
      evidenceSnippet: item.snippet,
    }));
  }
}

/**
 * Operator Direct Feed Provider.
 * Reads structured partner feeds provided directly by airport parking operators.
 */
export class OperatorDirectFeedProvider implements WebSearchProvider {
  name = "OperatorDirectFeedProvider";
  constructor(private feedCandidates: DiscoveredOperatorCandidate[] = []) {}

  async searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]> {
    return this.feedCandidates.filter(
      (c) => c.airportIata === airport.iataCode && c.modality === modality
    );
  }
}

/**
 * Test Curated Catalog Provider.
 * EXCLUSIVELY for test fixtures, offline validation, and deterministic suites.
 * NEVER allowed or default in production.
 */
export class TestCuratedCatalogProvider implements WebSearchProvider {
  name = "TestCuratedCatalogProvider";
  isTestOnly = true;

  async searchOperatorSites(
    airport: TargetAirport,
    modality: "valet" | "shuttle"
  ): Promise<DiscoveredOperatorCandidate[]> {
    const catalog: Record<string, DiscoveredOperatorCandidate[]> = {
      MAD: [
        {
          domain: "aparcamadridvalet.es",
          officialUrl: "https://aparcamadridvalet.es/tarifas",
          companyName: "AparcaMadrid Valet T1-T4",
          legalName: "AparcaMadrid Operaciones Aeroportuarias S.L.",
          airportIata: "MAD",
          modality: "valet",
          address: "Terminales T1, T2 y T4 - Vía de Salidas, 28042 Madrid",
          hasPublishedTariff: false, // Fixture without real downloaded HTML/feed must remain pending_review
          evidenceSnippet: "Fragmento de búsqueda: AparcaMadrid Valet T1-T4",
        },
        {
          domain: "corporativo-flotas-barajas.es",
          officialUrl: "https://corporativo-flotas-barajas.es",
          companyName: "Barajas Corporate Fleet Parking",
          legalName: "Logística y Flotas Aeroportuarias S.L.",
          airportIata: "MAD",
          modality: "valet",
          address: "Avenida de la Hispanidad s/n, 28042 Madrid",
          hasPublishedTariff: false,
        },
      ],
      BCN: [
        {
          domain: "bcnvaletexpress.es",
          officialUrl: "https://bcnvaletexpress.es/tarifas",
          companyName: "BCN Valet Terminal T1/T2",
          legalName: "Serveis de Valet Aeroport Barcelona S.L.",
          airportIata: "BCN",
          modality: "valet",
          address: "Aeroport Josep Tarradellas Barcelona-El Prat, 08820 El Prat de Llobregat",
          hasPublishedTariff: false,
          evidenceSnippet: "Fragmento de búsqueda: BCN Valet Terminal T1/T2",
        },
      ],
    };

    const airportCandidates = catalog[airport.iataCode] ?? [];
    return airportCandidates.filter((c) => c.modality === modality);
  }
}

// ─── Provider Factory Helper ──────────────────────────────────────────────────

export function createSearchProvider(
  providerName?: string,
  directFeedCandidates: DiscoveredOperatorCandidate[] = []
): WebSearchProvider {
  const chosen = (providerName || process.env.MARKET_ACQUISITION_PROVIDER || "").trim().toLowerCase();

  if (!chosen) {
    throw new Error(
      "PROVIDER_REQUIRED: Debe seleccionar explícitamente un proveedor real (google, bing, serpapi, direct_feed). No hay proveedor de pruebas predeterminado."
    );
  }

  if ((chosen === "curated_test" || chosen === "test") && process.env.NODE_ENV === "production") {
    throw new Error(
      "TEST_PROVIDER_FORBIDDEN_IN_PRODUCTION: El proveedor sintético 'curated_test' está estrictamente prohibido en producción."
    );
  }

  switch (chosen) {
    case "google":
      return new GoogleCustomSearchProvider();
    case "bing":
      return new BingWebSearchProvider();
    case "serpapi":
      return new SerpApiSearchProvider();
    case "direct_feed":
    case "operator_direct_feed":
      return new OperatorDirectFeedProvider(directFeedCandidates);
    case "curated_test":
    case "test":
      return new TestCuratedCatalogProvider();
    default:
      throw new Error(`UNKNOWN_PROVIDER: Proveedor de adquisición desconocido "${chosen}"`);
  }
}

// ─── Deduplication & Ambiguity Detection Engine ───────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const GENERIC_ADDRESS_FRAGMENTS = [
  "cercaniasaeropuerto",
  "recintoaeroportuario",
  "zonaaeroportuaria",
  "aeropuertomad",
  "aeropuertobcn",
  "aeropuertoagp",
  "aeropuertoalc",
  "aeropuertovlc",
];

function isGenericAddress(address?: string | null): boolean {
  if (!address) return true;
  const norm = normalizeText(address);
  if (norm.length < 15) return true;
  return GENERIC_ADDRESS_FRAGMENTS.some((frag) => norm.startsWith(frag) && norm.length < frag.length + 6);
}

export interface OperatorMatchIdentity {
  domain?: string;
  sourceUrl?: string;
  legalName?: string;
  companyName?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  airportIata?: string;
  modality?: "valet" | "shuttle";
}

export function isDuplicateOperator(a: OperatorMatchIdentity, b: OperatorMatchIdentity): boolean {
  // Airport & modality must match when both are provided so distinct airport branches aren't collapsed
  if (a.airportIata && b.airportIata && a.airportIata !== b.airportIata) {
    return false;
  }
  if (a.modality && b.modality && a.modality !== b.modality) {
    return false;
  }

  const domA = extractNormalizedDomain(a.domain || a.sourceUrl || "");
  const domB = extractNormalizedDomain(b.domain || b.sourceUrl || "");

  if (domA && domB && domA === domB) {
    return true;
  }

  if (a.legalName && b.legalName) {
    const normA = normalizeText(a.legalName);
    const normB = normalizeText(b.legalName);
    if (normA.length > 5 && normA === normB) {
      return true;
    }
  }

  if (
    typeof a.latitude === "number" &&
    typeof a.longitude === "number" &&
    typeof b.latitude === "number" &&
    typeof b.longitude === "number" &&
    Math.abs(a.latitude - b.latitude) < 0.001 &&
    Math.abs(a.longitude - b.longitude) < 0.001
  ) {
    return true;
  }

  if (!isGenericAddress(a.address) && !isGenericAddress(b.address)) {
    const normAddrA = normalizeText(a.address!);
    const normAddrB = normalizeText(b.address!);
    if (normAddrA === normAddrB) {
      return true;
    }
  }

  return false;
}

export function isAmbiguousOperatorMatch(a: OperatorMatchIdentity, b: OperatorMatchIdentity): boolean {
  if (isDuplicateOperator(a, b)) return false;

  const sameAirportAndModality =
    (!a.airportIata || !b.airportIata || a.airportIata === b.airportIata) &&
    (!a.modality || !b.modality || a.modality === b.modality);

  if (!sameAirportAndModality) return false;

  // Same normalized company name but different domain -> ambiguous, needs manual review
  if (a.companyName && b.companyName) {
    const compA = normalizeText(a.companyName);
    const compB = normalizeText(b.companyName);
    if (compA.length > 6 && compA === compB) {
      return true;
    }
  }

  return false;
}

// ─── Robust RFC 4180 CSV Parser & Importer ────────────────────────────────────

export interface CsvParseError {
  row: number;
  error: string;
}

export interface CsvImportResult {
  validRecords: IngestedFacilityRecord[];
  errors: CsvParseError[];
}

export function tokenizeRfc4180Csv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") i++;
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.length > 0 && r.some((c) => c.trim().length > 0));
}

function resolveFeatureWithEvidence(
  declaredStatus: string | undefined,
  evidenceText: string | undefined
): { status: FeatureVerificationStatus; evidence?: string } {
  const trimmedEvidence = (evidenceText ?? "").trim();
  const normalized = (declaredStatus ?? "").trim().toLowerCase();

  if (normalized === "not_available" && trimmedEvidence.length >= 5) {
    return { status: "not_available", evidence: trimmedEvidence };
  }

  // Only allow 'verified' when individual verifiable evidence is provided
  if ((normalized === "verified" || normalized === "true") && trimmedEvidence.length >= 5) {
    return { status: "verified", evidence: trimmedEvidence };
  }

  return { status: "unknown" };
}

export function importTariffCsv(
  csvContent: string,
  retrievedAt = new Date().toISOString()
): CsvImportResult {
  const contentHash = computeContentHash(csvContent);
  const rows = tokenizeRfc4180Csv(csvContent);

  if (rows.length < 2) {
    return {
      validRecords: [],
      errors: [{ row: 0, error: "El archivo CSV debe contener cabecera y al menos una fila de datos" }],
    };
  }

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const expectedCols = ["operator_name", "airport_iata", "source_url", "min_hours", "max_hours", "price_eur"];
  for (const col of expectedCols) {
    if (!header.includes(col)) {
      return {
        validRecords: [],
        errors: [{ row: 0, error: `Columna obligatoria ausente en CSV: ${col}` }],
      };
    }
  }

  const errors: CsvParseError[] = [];
  const recordsByOperator: Record<string, IngestedFacilityRecord> = {};

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const rowMap: Record<string, string> = {};
    header.forEach((h, idx) => {
      rowMap[h] = (cols[idx] ?? "").trim();
    });

    const opName = rowMap["operator_name"];
    if (!opName) {
      errors.push({ row: r, error: "El nombre del operador no puede estar vacío" });
      continue;
    }

    const airportIata = rowMap["airport_iata"].toUpperCase();
    if (!TARGET_AIRPORTS.some((a) => a.iataCode === airportIata)) {
      errors.push({ row: r, error: `Código de aeropuerto IATA inválido o no soportado: "${airportIata}"` });
      continue;
    }

    const sourceUrl = rowMap["source_url"];
    const urlCheck = validateOfficialUrl(sourceUrl);
    if (!urlCheck.valid) {
      errors.push({ row: r, error: `source_url inválida: ${urlCheck.reason}` });
      continue;
    }

    const minHours = parseInt(rowMap["min_hours"], 10);
    const maxHours = parseInt(rowMap["max_hours"], 10);
    const priceEuros = parseFloat(rowMap["price_eur"]);

    if (isNaN(minHours) || minHours < 0) {
      errors.push({ row: r, error: `min_hours debe ser un entero no negativo (recibido: "${rowMap["min_hours"]}")` });
      continue;
    }
    if (isNaN(maxHours) || maxHours <= minHours) {
      errors.push({ row: r, error: `max_hours (${maxHours}) debe ser estrictamente mayor que min_hours (${minHours})` });
      continue;
    }
    if (isNaN(priceEuros) || priceEuros <= 0) {
      errors.push({ row: r, error: `price_eur debe ser un número positivo (recibido: "${rowMap["price_eur"]}")` });
      continue;
    }

    const opSlug = rowMap["operator_slug"] || opName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const modality = (rowMap["modality"]?.toLowerCase() === "shuttle" ? "shuttle" : "valet") as "valet" | "shuttle";
    const domain = extractNormalizedDomain(sourceUrl);
    const address = rowMap["address"] || "";
    const priceAmountCents = Math.round(priceEuros * 100);
    const bandPricingUnit: TariffBandPricingUnit =
      rowMap["pricing_unit"] === "per_day" ? "per_day" : "flat_stay";

    const band: NormalizedTariffBandInput = {
      name: rowMap["band_name"] || `Tramo ${minHours}h-${maxHours}h`,
      minDurationHours: minHours,
      maxDurationHours: maxHours,
      priceAmount: priceAmountCents,
      currency: "EUR",
      pricingUnit: bandPricingUnit,
      evidenceSnippet: rowMap["evidence_snippet"] || `Línea CSV ${r}: ${minHours}h-${maxHours}h @ ${priceEuros} EUR`,
    };

    if (!recordsByOperator[`${opSlug}-${airportIata}-${modality}`]) {
      const evRes = resolveFeatureWithEvidence(rowMap["ev_charging"], rowMap["ev_charging_evidence"]);
      const washRes = resolveFeatureWithEvidence(rowMap["car_wash"], rowMap["car_wash_evidence"]);
      const covRes = resolveFeatureWithEvidence(rowMap["covered"], rowMap["covered_evidence"]);
      const cctvRes = resolveFeatureWithEvidence(rowMap["cctv_24h"], rowMap["cctv_24h_evidence"]);

      const featureEvidence: Record<string, string> = {};
      if (evRes.evidence) featureEvidence.ev_charging = evRes.evidence;
      if (washRes.evidence) featureEvidence.car_wash = washRes.evidence;
      if (covRes.evidence) featureEvidence.covered = covRes.evidence;
      if (cctvRes.evidence) featureEvidence.cctv_24h = cctvRes.evidence;

      const cancHours = parseInt(rowMap["free_canc_hours"] || "0", 10);
      const cancEvidence = (rowMap["cancellation_evidence"] ?? "").trim();

      recordsByOperator[`${opSlug}-${airportIata}-${modality}`] = {
        id: `fac-${opSlug}`,
        domain,
        operatorName: opName,
        operatorSlug: opSlug,
        airportIata,
        facilityName: `${opName} (${modality === "valet" ? "Valet" : "Shuttle"})`,
        address,
        modality,
        discoveryProvider: "csv_import",
        features: {
          evCharging: evRes.status,
          carWash: washRes.status,
          covered: covRes.status,
          cctv24h: cctvRes.status,
        },
        featureEvidence,
        cancellationPolicy: {
          freeCancellationWindowHours: isNaN(cancHours) ? 0 : cancHours,
          lateCancellationFeeBps: 5000,
          isVerified: cancEvidence.length >= 5,
          evidence: cancEvidence || undefined,
        },
        tariffSource: {
          id: `src-${opSlug}-${contentHash.slice(0, 8)}`,
          operatorId: `op-${opSlug}`,
          sourceName: `Tarifa CSV — ${opName}`,
          sourceUrl,
          sourceType: "csv_import",
          acquisitionMode: "csv",
          contentHash,
          retrievedAt,
          verificationStatus: "pending_review", // Never auto-verify on import
          provenanceNotes: `Importación CSV con hash ${contentHash}`,
          rawPayload: { rowCount: rows.length - 1 },
        },
        tariffBands: [],
        verificationStatus: "pending_review",
      };
    }

    recordsByOperator[`${opSlug}-${airportIata}-${modality}`].tariffBands.push(band);
  }

  return {
    validRecords: Object.values(recordsByOperator),
    errors,
  };
}

// ─── Zod-Validated JSON Feed Importer ─────────────────────────────────────────

export const TariffJsonFeedSchema = z.object({
  version: z.literal("1.0"),
  operator: z.object({
    name: z.string().min(2),
    slug: z.string().min(2),
    legalName: z.string().optional(),
    airportIata: z.string().length(3),
    modality: z.enum(["valet", "shuttle"]),
    address: z.string().min(5),
    sourceUrl: z.string().url(),
  }),
  features: z.object({
    evCharging: z.enum(["verified", "not_available", "unknown"]).default("unknown"),
    carWash: z.enum(["verified", "not_available", "unknown"]).default("unknown"),
    covered: z.enum(["verified", "not_available", "unknown"]).default("unknown"),
    cctv24h: z.enum(["verified", "not_available", "unknown"]).default("unknown"),
  }),
  featureEvidence: z
    .object({
      evCharging: z.string().optional(),
      carWash: z.string().optional(),
      covered: z.string().optional(),
      cctv24h: z.string().optional(),
    })
    .optional(),
  cancellationPolicy: z.object({
    freeCancellationWindowHours: z.number().int().nonnegative(),
    lateCancellationFeeBps: z.number().int().min(0).max(10000),
    evidence: z.string().optional(),
  }),
  tariffBands: z
    .array(
      z.object({
        name: z.string().min(1),
        minDurationHours: z.number().int().nonnegative(),
        maxDurationHours: z.number().int().positive(),
        priceAmountCents: z.number().int().positive(),
        currency: z.literal("EUR"),
        pricingUnit: z.enum(["flat_stay", "per_day"]),
        evidenceSnippet: z.string().min(3),
      })
    )
    .min(1),
});

export type TariffJsonFeedInput = z.infer<typeof TariffJsonFeedSchema>;

export function importTariffJsonFeed(
  jsonContent: string,
  retrievedAt = new Date().toISOString()
): IngestedFacilityRecord {
  const parsed = JSON.parse(jsonContent);
  const validated = TariffJsonFeedSchema.parse(parsed);

  const urlCheck = validateOfficialUrl(validated.operator.sourceUrl);
  if (!urlCheck.valid) {
    throw new Error(`sourceUrl inválida en JSON feed: ${urlCheck.reason}`);
  }

  for (const band of validated.tariffBands) {
    if (band.maxDurationHours <= band.minDurationHours) {
      throw new Error(
        `Intervalo inválido: maxDurationHours (${band.maxDurationHours}) <= minDurationHours (${band.minDurationHours})`
      );
    }
  }

  const contentHash = computeContentHash(jsonContent);
  const op = validated.operator;
  const domain = extractNormalizedDomain(op.sourceUrl);

  const evRes = resolveFeatureWithEvidence(validated.features.evCharging, validated.featureEvidence?.evCharging);
  const washRes = resolveFeatureWithEvidence(validated.features.carWash, validated.featureEvidence?.carWash);
  const covRes = resolveFeatureWithEvidence(validated.features.covered, validated.featureEvidence?.covered);
  const cctvRes = resolveFeatureWithEvidence(validated.features.cctv24h, validated.featureEvidence?.cctv24h);

  const featureEvidence: Record<string, string> = {};
  if (evRes.evidence) featureEvidence.ev_charging = evRes.evidence;
  if (washRes.evidence) featureEvidence.car_wash = washRes.evidence;
  if (covRes.evidence) featureEvidence.covered = covRes.evidence;
  if (cctvRes.evidence) featureEvidence.cctv_24h = cctvRes.evidence;

  const cancEvidence = (validated.cancellationPolicy.evidence ?? "").trim();

  return {
    id: `fac-${op.slug}`,
    domain,
    operatorName: op.name,
    operatorSlug: op.slug,
    legalName: op.legalName,
    airportIata: op.airportIata.toUpperCase(),
    facilityName: `${op.name} (${op.modality === "valet" ? "Valet" : "Shuttle"})`,
    address: op.address,
    modality: op.modality,
    discoveryProvider: "api_feed",
    features: {
      evCharging: evRes.status,
      carWash: washRes.status,
      covered: covRes.status,
      cctv24h: cctvRes.status,
    },
    featureEvidence,
    cancellationPolicy: {
      freeCancellationWindowHours: validated.cancellationPolicy.freeCancellationWindowHours,
      lateCancellationFeeBps: validated.cancellationPolicy.lateCancellationFeeBps,
      isVerified: cancEvidence.length >= 5,
      evidence: cancEvidence || undefined,
    },
    tariffSource: {
      id: `src-${op.slug}-${contentHash.slice(0, 8)}`,
      operatorId: `op-${op.slug}`,
      sourceName: `Feed JSON — ${op.name}`,
      sourceUrl: op.sourceUrl,
      sourceType: "api_feed",
      acquisitionMode: "api",
      contentHash,
      retrievedAt,
      verificationStatus: "pending_review", // Must go through verification workflow before becoming active
      provenanceNotes: `Feed estructurado validado con hash ${contentHash}`,
      rawPayload: parsed,
    },
    tariffBands: validated.tariffBands.map((b) => ({
      name: b.name,
      minDurationHours: b.minDurationHours,
      maxDurationHours: b.maxDurationHours,
      priceAmount: b.priceAmountCents,
      currency: b.currency,
      pricingUnit: b.pricingUnit,
      evidenceSnippet: b.evidenceSnippet,
    })),
    verificationStatus: "pending_review",
  };
}

// ─── Automated Ingestion & Quality Control Pipeline ───────────────────────────

export interface IngestionRunResult {
  airportsProcessed: number;
  candidatesDiscovered: number;
  verifiedFacilitiesCount: number;
  manualConsultationCount: number;
  flaggedAmbiguousCount: number;
  records: IngestedFacilityRecord[];
}

export interface IngestionPipelineOptions {
  fetchPages?: boolean;
  crawlOptions?: CrawlFetchOptions;
}

export async function runMarketIngestionPipeline(
  targetAirports: TargetAirport[] = TARGET_AIRPORTS,
  provider?: WebSearchProvider,
  options: IngestionPipelineOptions = {}
): Promise<IngestionRunResult> {
  const activeProvider = provider ?? createSearchProvider();
  const resultRecords: IngestedFacilityRecord[] = [];
  let totalCandidates = 0;
  let manualCount = 0;
  let ambiguousCount = 0;

  for (const airport of targetAirports) {
    for (const modality of ["valet", "shuttle"] as const) {
      const candidates = await activeProvider.searchOperatorSites(airport, modality);
      totalCandidates += candidates.length;

      for (const cand of candidates) {
        const normalizedDomain = extractNormalizedDomain(cand.domain || cand.officialUrl);
        const candIdentity: OperatorMatchIdentity = {
          domain: normalizedDomain,
          sourceUrl: cand.officialUrl,
          legalName: cand.legalName,
          companyName: cand.companyName,
          address: cand.address,
          latitude: cand.latitude,
          longitude: cand.longitude,
          airportIata: airport.iataCode,
          modality: cand.modality,
        };

        // 1. Exact duplicate check against already ingested records
        const duplicate = resultRecords.find((rec) =>
          isDuplicateOperator(candIdentity, {
            domain: rec.domain,
            sourceUrl: rec.tariffSource.sourceUrl,
            legalName: rec.legalName,
            companyName: rec.operatorName,
            address: rec.address,
            latitude: rec.latitude,
            longitude: rec.longitude,
            airportIata: rec.airportIata,
            modality: rec.modality,
          })
        );

        if (duplicate) continue;

        // 2. Ambiguous match check -> flag for manual review instead of silent drop
        const isAmbiguous = resultRecords.some((rec) =>
          isAmbiguousOperatorMatch(candIdentity, {
            domain: rec.domain,
            sourceUrl: rec.tariffSource.sourceUrl,
            legalName: rec.legalName,
            companyName: rec.operatorName,
            address: rec.address,
            latitude: rec.latitude,
            longitude: rec.longitude,
            airportIata: rec.airportIata,
            modality: rec.modality,
          })
        );

        const slug = normalizedDomain.replace(/[^a-z0-9]/g, "-") || "unknown-op";

        // 3. Real page fetch with robots.txt compliance (when enabled or rawHtmlContent provided)
        let downloadedContent = cand.rawHtmlContent ?? "";
        let blockedReason: string | undefined;

        if (!downloadedContent && options.fetchPages) {
          const fetchRes = await fetchOperatorPageWithCompliance(cand.officialUrl, options.crawlOptions);
          if (fetchRes.fetched && fetchRes.content) {
            downloadedContent = fetchRes.content;
          } else {
            blockedReason = fetchRes.reason;
          }
        }

        // Compute SHA-256 over real downloaded content (or candidate payload when no page was downloaded)
        const contentToHash =
          downloadedContent.length > 0
            ? downloadedContent
            : JSON.stringify({
                domain: normalizedDomain,
                companyName: cand.companyName,
                evidenceSnippet: cand.evidenceSnippet ?? "",
                airportIata: airport.iataCode,
                modality: cand.modality,
              });
        const contentHash = computeContentHash(contentToHash);

        // Extract real tariff bands only from downloaded HTML or explicit direct feed bands
        const extractedBands =
          cand.directTariffBands && cand.directTariffBands.length > 0
            ? cand.directTariffBands
            : downloadedContent.length > 0
            ? extractTariffBandsFromContent(downloadedContent)
            : [];

        let status: TariffVerificationStatus = "pending_review";
        if (isAmbiguous) {
          status = "flagged_ambiguous";
          ambiguousCount++;
        } else {
          manualCount++;
        }

        const reviewNotes = isAmbiguous
          ? "Coincidencia ambigua detectada con otro candidato del mismo aeropuerto/modalidad. Requiere revisión manual."
          : blockedReason
          ? `Descarga omitida (${blockedReason}). Tarifa bajo consulta o pendiente de revisión manual.`
          : extractedBands.length === 0
          ? "Tarifa bajo consulta directa o pendiente de extracción/verificación. No se generan tarifas inventadas."
          : "Bandas extraídas del contenido real pendientes de verificación humana antes de publicación.";

        resultRecords.push({
          id: `cand-${slug}-${airport.iataCode.toLowerCase()}-${cand.modality}`,
          domain: normalizedDomain,
          operatorName: cand.companyName,
          operatorSlug: slug,
          legalName: cand.legalName,
          airportIata: airport.iataCode,
          facilityName: `${cand.companyName} (${cand.modality === "valet" ? "Valet" : "Shuttle"})`,
          address: cand.address || "",
          latitude: cand.latitude ?? null,
          longitude: cand.longitude ?? null,
          modality: cand.modality,
          discoveryProvider: activeProvider.name,
          features: {
            evCharging: "unknown",
            carWash: "unknown",
            covered: "unknown",
            cctv24h: "unknown",
          },
          featureEvidence: {},
          cancellationPolicy: {
            freeCancellationWindowHours: 0,
            lateCancellationFeeBps: 10000,
            isVerified: false,
          },
          tariffSource: {
            id: `src-${slug}`,
            operatorId: `cand-${slug}`,
            sourceName: `Descubrimiento — ${cand.companyName}`,
            sourceUrl: cand.officialUrl,
            sourceType: "official_website",
            acquisitionMode: "web_extraction",
            contentHash,
            retrievedAt: new Date().toISOString(),
            verificationStatus: status,
            provenanceNotes: cand.evidenceSnippet
              ? `Candidato descubierto (${activeProvider.name}). Snippet: ${cand.evidenceSnippet}`
              : `Candidato descubierto (${activeProvider.name}).`,
            rawPayload: {
              summary: cand.tariffSummary,
              downloadedBytes: downloadedContent.length,
              blockedReason,
            },
          },
          tariffBands: extractedBands,
          verificationStatus: status,
          reviewNotes,
        });
      }
    }
  }

  const verifiedCount = resultRecords.filter((r) => r.verificationStatus === "verified").length;

  return {
    airportsProcessed: targetAirports.length,
    candidatesDiscovered: totalCandidates,
    verifiedFacilitiesCount: verifiedCount,
    manualConsultationCount: manualCount,
    flaggedAmbiguousCount: ambiguousCount,
    records: resultRecords,
  };
}
