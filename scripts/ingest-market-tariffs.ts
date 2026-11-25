#!/usr/bin/env node
/**
 * AeroValet — Offline & Live Market Tariff Ingestion CLI Runner
 *
 * Usage:
 *   npx tsx scripts/ingest-market-tariffs.ts [--csv=path/to/tariffs.csv] [--airports=MAD,BCN]
 */

import {
  TARGET_AIRPORTS,
  runMarketIngestionPipeline,
  importTariffCsv,
} from "@/server/discovery/acquisition";

async function main() {
  console.log("════════════════════════════════════════════════════════════════════════════════");
  console.log("AEROVALET — MARKET TARIFF ACQUISITION & INGESTION PIPELINE");
  console.log("════════════════════════════════════════════════════════════════════════════════");

  const startTime = Date.now();
  const result = await runMarketIngestionPipeline(TARGET_AIRPORTS);

  console.log(`\n[+] Proceso de adquisición completado en ${Date.now() - startTime} ms`);
  console.log(`[+] Aeropuertos inspeccionados: ${result.airportsProcessed}`);
  console.log(`[+] Candidatos descubiertos: ${result.candidatesDiscovered}`);
  console.log(`[+] Instalaciones con tarifa verificada: ${result.verifiedFacilitiesCount}`);
  console.log(`[+] Operadores derivados a consulta manual: ${result.manualConsultationCount}`);
  console.log(`[+] Tarifas ambiguas en cola de revisión: ${result.flaggedAmbiguousCount}`);

  console.log("\n--- REGISTRO DE INSTALACIONES PROCESADAS ---");
  for (const rec of result.records) {
    const statusIcon = rec.verificationStatus === "verified" ? "✅" : "📋";
    console.log(
      `${statusIcon} [${rec.airportIata}] ${rec.operatorName} (${rec.modality.toUpperCase()}) — Estado: ${rec.verificationStatus}`
    );
    if (rec.tariffBands.length > 0) {
      console.log(`   └─ ${rec.tariffBands.length} tramos tarifarios normalizados | Hash: ${rec.tariffSource.contentHash.slice(0, 16)}...`);
    } else {
      console.log(`   └─ Sin tarifas públicas automatizables (${rec.reviewNotes})`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("[-] Error en pipeline de adquisición:", err);
  process.exit(1);
});
