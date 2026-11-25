#!/usr/bin/env node
/**
 * AeroValet — Market Data Ingestion & Persistence CLI Runner
 *
 * Requirements:
 * 1. Accepts arguments: --csv=<path>, --airports=<IATA1,IATA2>, --provider=<google|bing|serpapi|curated>, --dry-run
 * 2. Validates credentials and environment.
 * 3. In live persistence mode, uses Supabase service_role client exclusively (never anon key).
 * 4. Upserts operators, facilities, services, operator_tariff_sources, and service_tariff_bands.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  TARGET_AIRPORTS,
  runMarketIngestionPipeline,
  importTariffCsv,
  createSearchProvider,
  type IngestedFacilityRecord,
} from "@/server/discovery/acquisition";

function parseArgs() {
  const args = process.argv.slice(2);
  let csvPath: string | undefined;
  let airportsArg: string | undefined;
  let providerArg: string = "curated_test";
  let dryRun: boolean = false;

  for (const arg of args) {
    if (arg.startsWith("--csv=")) {
      csvPath = arg.slice(6);
    } else if (arg.startsWith("--airports=")) {
      airportsArg = arg.slice(11);
    } else if (arg.startsWith("--provider=")) {
      providerArg = arg.slice(11);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { csvPath, airportsArg, providerArg, dryRun };
}

async function persistRecordToSupabase(
  supabase: any,
  rec: IngestedFacilityRecord
) {
  // 1. Resolve airport_id by IATA code
  const { data: airport, error: apErr } = await (supabase as any)
    .from("airports")
    .select("id")
    .eq("iata_code", rec.airportIata)
    .single();

  if (apErr || !airport) {
    throw new Error(`Aeropuerto con IATA "${rec.airportIata}" no encontrado en base de datos`);
  }

  // 2. Upsert Operator
  const { data: opData, error: opErr } = await (supabase as any)
    .from("operators")
    .upsert(
      {
        name: rec.operatorName,
        legal_name: rec.legalName || rec.operatorName,
        email: `contacto@${rec.operatorSlug}.example`,
        currency: "EUR",
        status: "active",
      },
      { onConflict: "name" }
    )
    .select("id")
    .single();

  if (opErr || !opData) {
    throw new Error(`Error insertando operador ${rec.operatorName}: ${opErr?.message}`);
  }

  // 3. Upsert Facility with structured feature verification status
  const { data: facData, error: facErr } = await (supabase as any)
    .from("facilities")
    .upsert(
      {
        operator_id: opData.id,
        airport_id: airport.id,
        name: rec.facilityName,
        address: rec.address,
        total_capacity: 50,
        operational_buffer: 5,
        feature_ev_charging: rec.features.evCharging,
        feature_car_wash: rec.features.carWash,
        feature_covered: rec.features.covered,
        feature_cctv_24h: rec.features.cctv24h,
        feature_evidence: { source: rec.tariffSource.sourceUrl },
        active: true,
      },
      { onConflict: "operator_id,airport_id,name" }
    )
    .select("id")
    .single();

  if (facErr || !facData) {
    throw new Error(`Error insertando instalación ${rec.facilityName}: ${facErr?.message}`);
  }

  // 4. Upsert Tariff Source linked to this operator
  const { data: srcData, error: srcErr } = await (supabase as any)
    .from("operator_tariff_sources")
    .upsert(
      {
        operator_id: opData.id,
        source_name: rec.tariffSource.sourceName,
        source_url: rec.tariffSource.sourceUrl,
        source_type: rec.tariffSource.sourceType,
        acquisition_mode: rec.tariffSource.acquisitionMode,
        content_hash: rec.tariffSource.contentHash,
        retrieved_at: rec.tariffSource.retrievedAt,
        verification_status: rec.verificationStatus,
        provenance_notes: rec.tariffSource.provenanceNotes,
        raw_payload: rec.tariffSource.rawPayload,
      },
      { onConflict: "operator_id,source_name" }
    )
    .select("id")
    .single();

  if (srcErr || !srcData) {
    throw new Error(`Error insertando fuente tarifaria: ${srcErr?.message}`);
  }

  // 5. Upsert Main Service
  const serviceName = rec.modality === "valet" ? "Servicio Valet VIP" : "Servicio Shuttle Express";
  const { data: srvData, error: srvErr } = await (supabase as any)
    .from("services")
    .upsert(
      {
        facility_id: facData.id,
        source_id: srcData.id,
        name: serviceName,
        price_amount: rec.tariffBands[0]?.priceAmount ?? 2000,
        currency: "EUR",
        pricing_unit: "flat",
        active: true,
      },
      { onConflict: "facility_id,name" }
    )
    .select("id")
    .single();

  if (srvErr || !srvData) {
    throw new Error(`Error insertando servicio: ${srvErr?.message}`);
  }

  // 6. Upsert Tariff Bands (if verified)
  for (const band of rec.tariffBands) {
    const { error: bandErr } = await (supabase as any)
      .from("service_tariff_bands")
      .upsert(
        {
          service_id: srvData.id,
          source_id: srcData.id,
          name: band.name,
          min_duration_hours: band.minDurationHours,
          max_duration_hours: band.maxDurationHours,
          price_amount: band.priceAmount,
          currency: band.currency,
          pricing_unit: band.pricingUnit,
          evidence_snippet: band.evidenceSnippet || "Evidencia verificada",
          review_status: rec.verificationStatus,
          active: rec.verificationStatus === "verified",
        },
        { onConflict: "service_id,min_duration_hours,max_duration_hours" }
      );

    if (bandErr) {
      throw new Error(`Error insertando tramo tarifario ${band.name}: ${bandErr.message}`);
    }
  }
}

async function main() {
  const { csvPath, airportsArg, providerArg, dryRun } = parseArgs();

  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log("AEROVALET — MARKET DATA INGESTION & PERSISTENCE PIPELINE");
  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log(`[+] Modo: ${dryRun ? "DRY RUN (sin persistencia en base de datos)" : "PERSISTENCIA TRANSACCIONAL (service_role)"}`);
  console.log(`[+] Proveedor: ${providerArg}`);

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
  } else {
    let targetAirports = TARGET_AIRPORTS;
    if (airportsArg) {
      const iatas = airportsArg.split(",").map((s) => s.trim().toUpperCase());
      targetAirports = TARGET_AIRPORTS.filter((a) => iatas.includes(a.iataCode));
    }
    const provider = createSearchProvider(providerArg);
    const result = await runMarketIngestionPipeline(targetAirports, provider);
    records = result.records;
  }

  console.log(`\n[+] Registros procesados listos para ingestión: ${records.length}`);
  records.forEach((r) => {
    console.log(`   - [${r.airportIata}] ${r.operatorName} (${r.modality}): ${r.tariffBands.length} bandas, estado: ${r.verificationStatus}`);
  });

  if (dryRun) {
    console.log("\n[+] Fin de ejecución DRY RUN. Ningún cambio aplicado en PostgreSQL.");
    return;
  }

  // Live persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("\n[!] OMITIDA persistencia en Supabase: variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY no configuradas.");
    console.log("[i] Para persistir en Supabase, ejecute con SUPABASE_SERVICE_ROLE_KEY válida en el entorno.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log("\n[+] Conectando a Supabase vía service_role...");

  for (const rec of records) {
    await persistRecordToSupabase(supabase, rec);
    console.log(`[+] Persistido con éxito: ${rec.facilityName}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════════════════════");
  console.log("INSPECCIÓN E INGESTIÓN DE MERCADO COMPLETADA CON ÉXITO");
  console.log("════════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("[-] Error en pipeline de ingestión:", err);
  process.exit(1);
});
