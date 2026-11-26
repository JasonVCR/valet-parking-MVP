#!/usr/bin/env node
/**
 * AeroValet — Market Data Ingestion & Persistence CLI Runner
 *
 * Requirements (Increment 8.3):
 * 1. Accepts arguments: --csv=<path>, --json=<path>, --airports=<IATA1,IATA2>, --provider=<google|bing|serpapi|direct_feed|curated_test>, --fetch-pages, --dry-run
 * 2. Strictly forbids curated_test/test in production and requires explicit real provider.
 * 3. In live persistence mode, uses Supabase service_role client exclusively and calls
 *    transactional SQL RPC `ingest_market_candidate` (never inserts active operators directly).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  TARGET_AIRPORTS,
  runMarketIngestionPipeline,
  importTariffCsv,
  importTariffJsonFeed,
  createSearchProvider,
  type IngestedFacilityRecord,
} from "@/server/discovery/acquisition";

function parseArgs() {
  const args = process.argv.slice(2);
  let csvPath: string | undefined;
  let jsonPath: string | undefined;
  let airportsArg: string | undefined;
  let providerArg: string | undefined;
  let fetchPages = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith("--csv=")) {
      csvPath = arg.slice(6);
    } else if (arg.startsWith("--json=")) {
      jsonPath = arg.slice(7);
    } else if (arg.startsWith("--airports=")) {
      airportsArg = arg.slice(11);
    } else if (arg.startsWith("--provider=")) {
      providerArg = arg.slice(11);
    } else if (arg === "--fetch-pages") {
      fetchPages = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { csvPath, jsonPath, airportsArg, providerArg, fetchPages, dryRun };
}

async function persistCandidateTransactionally(
  supabase: SupabaseClient<any, any, any>,
  rec: IngestedFacilityRecord
): Promise<string> {
  const payload = {
    domain: rec.domain,
    company_name: rec.operatorName,
    legal_name: rec.legalName ?? null,
    airport_iata: rec.airportIata,
    modality: rec.modality,
    source_url: rec.tariffSource.sourceUrl,
    address: rec.address || null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    discovery_provider: rec.discoveryProvider,
    evidence_snippet: rec.tariffSource.provenanceNotes ?? null,
    content_hash: rec.tariffSource.contentHash,
    review_status: rec.verificationStatus,
    review_notes: rec.reviewNotes ?? null,
    feature_ev_charging: rec.features.evCharging,
    feature_car_wash: rec.features.carWash,
    feature_covered: rec.features.covered,
    feature_cctv_24h: rec.features.cctv24h,
    feature_evidence: rec.featureEvidence,
    cancellation_free_window_hours: rec.cancellationPolicy.freeCancellationWindowHours,
    cancellation_late_fee_bps: rec.cancellationPolicy.lateCancellationFeeBps,
    cancellation_verified: rec.cancellationPolicy.isVerified,
    cancellation_evidence: rec.cancellationPolicy.evidence ?? null,
    tariff_bands: rec.tariffBands.map((b) => ({
      name: b.name,
      min_duration_hours: b.minDurationHours,
      max_duration_hours: b.maxDurationHours,
      price_amount: b.priceAmount,
      currency: b.currency,
      pricing_unit: b.pricingUnit,
      evidence_snippet: b.evidenceSnippet,
      review_status: rec.verificationStatus,
    })),
  };

  const { data, error } = await (supabase as any).rpc("ingest_market_candidate", {
    p_payload: payload,
  });

  if (error) {
    throw new Error(`Error transaccional persistiendo candidato ${rec.operatorName}: ${error.message}`);
  }

  return String(data);
}

async function main() {
  const { csvPath, jsonPath, airportsArg, providerArg, fetchPages, dryRun } = parseArgs();

  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log("AEROVALET — MARKET DATA INGESTION & TRANSACTIONAL CANDIDATE PIPELINE");
  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log(`[+] Modo: ${dryRun ? "DRY RUN (sin persistencia en base de datos)" : "PERSISTENCIA TRANSACCIONAL RPC (service_role)"}`);

  let records: IngestedFacilityRecord[] = [];

  if (csvPath) {
    const absolutePath = resolve(process.cwd(), csvPath);
    console.log(`[+] Cargando archivo CSV: ${absolutePath}`);
    const csvContent = readFileSync(absolutePath, "utf-8");
    const { validRecords, errors } = importTariffCsv(csvContent);
    if (errors.length > 0) {
      console.warn(`[!] Advertencia: se detectaron ${errors.length} errores en filas del CSV:`);
      errors.forEach((e) => console.warn(`   Fila ${e.row}: ${e.error}`));
    }
    records = validRecords;
  } else if (jsonPath) {
    const absolutePath = resolve(process.cwd(), jsonPath);
    console.log(`[+] Cargando archivo JSON: ${absolutePath}`);
    const jsonContent = readFileSync(absolutePath, "utf-8");
    const parsed = JSON.parse(jsonContent);
    if (Array.isArray(parsed)) {
      records = parsed.map((item) => importTariffJsonFeed(JSON.stringify(item)));
    } else {
      records = [importTariffJsonFeed(jsonContent)];
    }
  } else {
    const provider = createSearchProvider(providerArg);
    console.log(`[+] Proveedor: ${provider.name}`);
    let targetAirports = TARGET_AIRPORTS;
    if (airportsArg) {
      const iatas = airportsArg.split(",").map((s) => s.trim().toUpperCase());
      targetAirports = TARGET_AIRPORTS.filter((a) => iatas.includes(a.iataCode));
    }
    const result = await runMarketIngestionPipeline(targetAirports, provider, { fetchPages });
    records = result.records;
    console.log(`[+] Ambiguos marcados para revisión manual: ${result.flaggedAmbiguousCount}`);
  }

  console.log(`\n[+] Candidatos procesados listos para ingestión: ${records.length}`);
  records.forEach((r) => {
    console.log(`   - [${r.airportIata}] ${r.operatorName} (${r.modality}): ${r.tariffBands.length} bandas, estado: ${r.verificationStatus}`);
  });

  if (dryRun) {
    console.log("\n[+] Fin de ejecución DRY RUN. Ningún cambio aplicado en PostgreSQL.");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("\n[!] OMITIDA persistencia en Supabase: variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY no configuradas.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log("\n[+] Conectando a Supabase vía service_role...");

  for (const rec of records) {
    const candidateId = await persistCandidateTransactionally(supabase, rec);
    console.log(`[+] Candidato persistido transaccionalmente (${candidateId}): ${rec.facilityName}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════════════════════");
  console.log("INSPECCIÓN E INGESTIÓN DE MERCADO COMPLETADA CON ÉXITO");
  console.log("════════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("[-] Error en pipeline de ingestión:", err);
  process.exit(1);
});
