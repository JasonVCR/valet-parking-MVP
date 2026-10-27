/**
 * Synthetic Demo Catalog for AeroValet (Sandbox / Local Demonstration Only).
 *
 * CRITICAL TRANSPARENCY NOTICE:
 * These records are strictly synthetic test fixtures designed to exercise
 * the search engine, tariff bands, extras, and booking hold workflows
 * when local credentials for PostgreSQL/Supabase are not configured.
 *
 * They DO NOT represent real commercial entities, verified corporate rates,
 * or contractual offers. All names, addresses, and rates are sandbox demonstrations.
 */

import type {
  FacilityWithServices,
  ServiceTariffBand,
  ServiceExtra,
  CancellationPolicyRule,
  TariffSourceMeta,
} from "@/types/domain";
import { calculateQuote } from "@/lib/pricing/engine";

export interface DemoOperatorEntry {
  facility: FacilityWithServices;
  tariffBands: ServiceTariffBand[];
  extras: ServiceExtra[];
  cancellationPolicy: CancellationPolicyRule;
  tariffSource: TariffSourceMeta;
  hasPublishedTariff: boolean;
  isDemoSynthetic: true;
}

const DEMO_MAD_AIRPORT_ID = "a0000000-0000-4000-a000-000000000001";

export const SYNTHETIC_DEMO_CATALOG: DemoOperatorEntry[] = [
  {
    isDemoSynthetic: true,
    hasPublishedTariff: true,
    tariffSource: {
      source_id: "demo-src-01",
      source_name: "Tarifa Sintética Sandbox — Valet T1/T4 (Demostración)",
      source_type: "manual_verified",
      source_url: "https://sandbox.aerovalet.demo/tarifas-demo-valet",
      retrieved_at: "2026-10-26T10:00:00Z",
      verification_status: "pending_review",
    },
    facility: {
      id: "demo-fac-valet-01",
      operator_id: "demo-op-valet-01",
      airport_id: DEMO_MAD_AIRPORT_ID,
      name: "AeroValet Demo Valet — Simulación Terminal Salidas",
      address: "Terminal T1-T4 Vía Salidas (Entorno Sandbox de Demostración)",
      latitude: 40.4983,
      longitude: -3.5676,
      total_capacity: 100,
      operational_buffer: 10,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "demo-op-valet-01",
        name: "AeroValet Sandbox Operator A S.L. (Demostración)",
        currency: "EUR",
      },
      services: [
        {
          id: "demo-srv-valet-01",
          facility_id: "demo-fac-valet-01",
          name: "Servicio Valet Demostración (Sandbox)",
          description: "Servicio de demostración de entrega y recogida en terminal",
          price_amount: 1900, // 19.00 EUR / día tarifa estándar de prueba
          currency: "EUR",
          pricing_unit: "per_day",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "demo-canc-01",
      operator_id: "demo-op-valet-01",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 24,
      late_cancellation_fee_bps: 5000,
      no_show_fee_bps: 10000,
      allow_modifications: true,
      modification_window_hours: 2,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    tariffBands: [
      {
        id: "demo-band-01-1d",
        service_id: "demo-srv-valet-01",
        source_id: "demo-src-01",
        name: "Tramo Fijo 24h (Demo)",
        min_duration_hours: 0,
        max_duration_hours: 24,
        price_amount: 2200, // 22.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-band-01-2d",
        service_id: "demo-srv-valet-01",
        source_id: "demo-src-01",
        name: "Tramo Fijo 48h (Demo)",
        min_duration_hours: 25,
        max_duration_hours: 48,
        price_amount: 3400, // 34.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-band-01-3d",
        service_id: "demo-srv-valet-01",
        source_id: "demo-src-01",
        name: "Tramo Fijo Fin de Semana 72h (Demo)",
        min_duration_hours: 49,
        max_duration_hours: 72,
        price_amount: 4200, // 42.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-band-01-7d",
        service_id: "demo-srv-valet-01",
        source_id: "demo-src-01",
        name: "Tramo Fijo 7 Días (Demo)",
        min_duration_hours: 73,
        max_duration_hours: 168,
        price_amount: 6800, // 68.00 EUR flat
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
    extras: [
      {
        id: "demo-ext-01-wash",
        facility_id: "demo-fac-valet-01",
        service_id: "demo-srv-valet-01",
        name: "Lavado Exterior a Mano (Demo)",
        description: "Servicio de demostración de limpieza exterior",
        price_amount: 1800,
        currency: "EUR",
        pricing_unit: "per_stay",
        is_mandatory: false,
        max_quantity: 1,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-ext-01-ev",
        facility_id: "demo-fac-valet-01",
        service_id: "demo-srv-valet-01",
        name: "Recarga Vehículo Eléctrico (Demo)",
        description: "Servicio de demostración de recarga VE",
        price_amount: 2200,
        currency: "EUR",
        pricing_unit: "per_stay",
        is_mandatory: false,
        max_quantity: 1,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
  },
  {
    isDemoSynthetic: true,
    hasPublishedTariff: true,
    tariffSource: {
      source_id: "demo-src-02",
      source_name: "Tarifa Sintética Sandbox — Lanzadera Shuttle (Demostración)",
      source_type: "manual_verified",
      source_url: "https://sandbox.aerovalet.demo/tarifas-demo-shuttle",
      retrieved_at: "2026-10-26T10:00:00Z",
      verification_status: "pending_review",
    },
    facility: {
      id: "demo-fac-shuttle-02",
      operator_id: "demo-op-shuttle-02",
      airport_id: DEMO_MAD_AIRPORT_ID,
      name: "AeroValet Demo Lanzadera — Simulación Recinto Cubierto",
      address: "Calle Demo Transporte 12 (Entorno Sandbox de Demostración)",
      latitude: 40.4851,
      longitude: -3.5823,
      total_capacity: 200,
      operational_buffer: 15,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "demo-op-shuttle-02",
        name: "AeroValet Sandbox Operator B S.L. (Demostración)",
        currency: "EUR",
      },
      services: [
        {
          id: "demo-srv-shuttle-02",
          facility_id: "demo-fac-shuttle-02",
          name: "Servicio Lanzadera Demostración (Sandbox)",
          description: "Servicio de demostración de transporte en minibús cada 15 min",
          price_amount: 1200, // 12.00 EUR / día tarifa estándar de prueba
          currency: "EUR",
          pricing_unit: "per_day",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "demo-canc-02",
      operator_id: "demo-op-shuttle-02",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 12,
      late_cancellation_fee_bps: 10000,
      no_show_fee_bps: 10000,
      allow_modifications: true,
      modification_window_hours: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    tariffBands: [
      {
        id: "demo-band-02-1d",
        service_id: "demo-srv-shuttle-02",
        source_id: "demo-src-02",
        name: "Tramo 1 Día (Demo)",
        min_duration_hours: 0,
        max_duration_hours: 24,
        price_amount: 1600,
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-band-02-3d",
        service_id: "demo-srv-shuttle-02",
        source_id: "demo-src-02",
        name: "Tramo Fin de Semana (3 días) (Demo)",
        min_duration_hours: 25,
        max_duration_hours: 72,
        price_amount: 3200,
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "demo-band-02-7d",
        service_id: "demo-srv-shuttle-02",
        source_id: "demo-src-02",
        name: "Tramo 7 Días (Demo)",
        min_duration_hours: 73,
        max_duration_hours: 168,
        price_amount: 4800,
        currency: "EUR",
        pricing_unit: "flat_stay",
        vehicle_category: null,
        valid_from: null,
        valid_until: null,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
    extras: [
      {
        id: "demo-ext-02-keys",
        facility_id: "demo-fac-shuttle-02",
        service_id: "demo-srv-shuttle-02",
        name: "Custodia de Llaves (Demo)",
        description: "Servicio de demostración de custodia de llaves",
        price_amount: 300,
        currency: "EUR",
        pricing_unit: "per_stay",
        is_mandatory: false,
        max_quantity: 1,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
    ],
  },
  {
    isDemoSynthetic: true,
    hasPublishedTariff: false,
    tariffSource: {
      source_id: "demo-src-03",
      source_name: "Operador de Prueba sin Tarifa Pública (Demo)",
      source_type: "manual_verified",
      source_url: null,
      retrieved_at: "2026-10-26T10:00:00Z",
      verification_status: "pending_review",
    },
    facility: {
      id: "demo-fac-manual-03",
      operator_id: "demo-op-manual-03",
      airport_id: DEMO_MAD_AIRPORT_ID,
      name: "AeroValet Demo Flotas — Consulta Manual Sandbox",
      address: "Zona Industrial Demo (Entorno Sandbox de Demostración)",
      latitude: 40.5102,
      longitude: -3.5512,
      total_capacity: 80,
      operational_buffer: 5,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "demo-op-manual-03",
        name: "AeroValet Sandbox Operator C S.L. (Demostración)",
        currency: "EUR",
      },
      services: [
        {
          id: "demo-srv-manual-03",
          facility_id: "demo-fac-manual-03",
          name: "Tarifa Flotas bajo Presupuesto (Sandbox)",
          description: "Servicio de demostración bajo consulta manual",
          price_amount: 0,
          currency: "EUR",
          pricing_unit: "per_stay",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "demo-canc-03",
      operator_id: "demo-op-manual-03",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 0,
      late_cancellation_fee_bps: 10000,
      no_show_fee_bps: 10000,
      allow_modifications: false,
      modification_window_hours: 0,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    tariffBands: [],
    extras: [],
  },
];

export function getDemoSyntheticFacilities(
  airportId: string,
  entryAt: string,
  exitAt: string
): {
  verifiedFacilities: FacilityWithServices[];
  manualConsultationFacilities: FacilityWithServices[];
} {
  const verifiedList: FacilityWithServices[] = [];
  const manualList: FacilityWithServices[] = [];

  for (const entry of SYNTHETIC_DEMO_CATALOG) {
    if (
      airportId &&
      airportId !== "" &&
      entry.facility.airport_id !== airportId &&
      airportId !== "00000000-0000-4000-a000-000000000001" &&
      airportId !== DEMO_MAD_AIRPORT_ID
    ) {
      continue;
    }

    const primaryService = entry.facility.services[0];
    if (!primaryService) continue;

    if (entry.hasPublishedTariff) {
      try {
        const quote = calculateQuote({
          serviceId: primaryService.id,
          serviceName: primaryService.name,
          basePriceAmount: primaryService.price_amount,
          currency: primaryService.currency,
          pricingUnit: primaryService.pricing_unit,
          entryAt,
          exitAt,
          tariffBands: entry.tariffBands,
          availableExtras: entry.extras,
          tariffSource: entry.tariffSource,
        });

        const enriched: FacilityWithServices = {
          ...entry.facility,
          tariff_bands: entry.tariffBands,
          extras: entry.extras,
          cancellation_policy: entry.cancellationPolicy,
          server_quote: quote,
        };

        verifiedList.push(enriched);
      } catch {
        // Interval range error or exceeds bands: mark as manual/unavailable
      }
    } else {
      const manualEnriched: FacilityWithServices = {
        ...entry.facility,
        tariff_bands: [],
        extras: [],
        cancellation_policy: entry.cancellationPolicy,
        server_quote: null,
      };
      manualList.push(manualEnriched);
    }
  }

  // Neutral ranking: sort strictly by customer_total_amount ascending
  verifiedList.sort((a, b) => {
    const priceA = a.server_quote?.customer_total_amount ?? Infinity;
    const priceB = b.server_quote?.customer_total_amount ?? Infinity;
    return priceA - priceB;
  });

  return {
    verifiedFacilities: verifiedList,
    manualConsultationFacilities: manualList,
  };
}
