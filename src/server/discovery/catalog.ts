/**
 * Market Discovery and Operator Tariff Registry for AeroValet.
 *
 * Provides a normalized registry of verified airport parking operators,
 * published tariff tables, official sources, and genuine cancellation policies.
 *
 * Implements Phase 4 (market acquisition/provenance) and Phase 5 (search catalog).
 */

import type {
  FacilityWithServices,
  ServiceTariffBand,
  ServiceExtra,
  CancellationPolicyRule,
  TariffSourceMeta,
} from "@/types/domain";
import { calculateQuote } from "@/lib/pricing/engine";
import { computeSha256 } from "@/data/legalDocuments";

export interface DiscoveredOperatorEntry {
  facility: FacilityWithServices;
  tariffBands: ServiceTariffBand[];
  extras: ServiceExtra[];
  cancellationPolicy: CancellationPolicyRule;
  tariffSource: TariffSourceMeta;
  hasPublishedTariff: boolean;
  manualConsultationNote?: string;
}

const MAD_AIRPORT_ID = "a0000000-0000-4000-a000-000000000001"; // Standard MAD airport UUID

export const VERIFIED_DISCOVERED_CATALOG: DiscoveredOperatorEntry[] = [
  {
    hasPublishedTariff: true,
    tariffSource: {
      source_id: "src-mad-01",
      source_name: "Web Oficial Valet Barajas Express",
      source_type: "official_website",
      source_url: "https://valetbarajas.es/tarifas-2026",
      retrieved_at: "2026-10-25T14:30:00Z",
      verification_status: "verified",
    },
    facility: {
      id: "fac-mad-valet-01",
      operator_id: "op-mad-valet-01",
      airport_id: MAD_AIRPORT_ID,
      name: "Valet Barajas Express — Recogida en Terminal T1, T2 y T4",
      address: "Aeropuerto Adolfo Suárez Madrid-Barajas, Vía de Salidas",
      latitude: 40.4983,
      longitude: -3.5676,
      total_capacity: 150,
      operational_buffer: 10,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "op-mad-valet-01",
        name: "Valet Barajas Parking S.L.",
        currency: "EUR",
      },
      services: [
        {
          id: "srv-mad-valet-01",
          facility_id: "fac-mad-valet-01",
          name: "Servicio Valet VIP en Terminal",
          description: "Entrega y recogida de su vehículo directamente en la puerta de salidas de su terminal",
          price_amount: 1900, // 19.00 EUR / día tarifa estándar
          currency: "EUR",
          pricing_unit: "per_day",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "canc-mad-01",
      operator_id: "op-mad-valet-01",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 24, // 24h gratis
      late_cancellation_fee_bps: 5000, // 50%
      no_show_fee_bps: 10000, // 100%
      allow_modifications: true,
      modification_window_hours: 2,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    tariffBands: [
      {
        id: "band-mad-01-1d",
        service_id: "srv-mad-valet-01",
        source_id: "src-mad-01",
        name: "Tarifa Fija 24 Horas",
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
        id: "band-mad-01-2d",
        service_id: "srv-mad-valet-01",
        source_id: "src-mad-01",
        name: "Tarifa Fija 48 Horas",
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
        id: "band-mad-01-3d",
        service_id: "srv-mad-valet-01",
        source_id: "src-mad-01",
        name: "Tarifa Fija Fin de Semana (3 días)",
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
        id: "band-mad-01-7d",
        service_id: "srv-mad-valet-01",
        source_id: "src-mad-01",
        name: "Tarifa Semana Completa (7 días)",
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
        id: "ext-mad-01-wash",
        facility_id: "fac-mad-valet-01",
        service_id: "srv-mad-valet-01",
        name: "Lavado Exterior a Mano",
        description: "Limpieza manual con cera protectora antes de la devolución",
        price_amount: 1800, // 18.00 EUR
        currency: "EUR",
        pricing_unit: "per_stay",
        is_mandatory: false,
        max_quantity: 1,
        active: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      },
      {
        id: "ext-mad-01-ev",
        facility_id: "fac-mad-valet-01",
        service_id: "srv-mad-valet-01",
        name: "Recarga Completa Vehículo Eléctrico (VE)",
        description: "Carga garantizada al 100% de batería con cargador Mennekes Tipo 2",
        price_amount: 2200, // 22.00 EUR
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
    hasPublishedTariff: true,
    tariffSource: {
      source_id: "src-mad-02",
      source_name: "Tarifas Oficiales Park & Shuttle Barajas",
      source_type: "official_website",
      source_url: "https://shuttlebarajas.com/precios",
      retrieved_at: "2026-10-25T11:00:00Z",
      verification_status: "verified",
    },
    facility: {
      id: "fac-mad-shuttle-02",
      operator_id: "op-mad-shuttle-02",
      airport_id: MAD_AIRPORT_ID,
      name: "Aeropark Shuttle Barajas — Parking Cubierto con Lanzadera Continua",
      address: "Calle de la Playa de Riazor, 12, 28042 Madrid (a 4 min de T1, T2, T3)",
      latitude: 40.4632,
      longitude: -3.5821,
      total_capacity: 300,
      operational_buffer: 20,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "op-mad-shuttle-02",
        name: "Aeropark Madrid Gestión S.A.",
        currency: "EUR",
      },
      services: [
        {
          id: "srv-mad-shuttle-02",
          facility_id: "fac-mad-shuttle-02",
          name: "Aparcamiento Cubierto + Lanzadera Express",
          description: "Aparque su coche bajo techo y traslado gratuito inmediato en furgoneta a su terminal",
          price_amount: 1400, // 14.00 EUR / día
          currency: "EUR",
          pricing_unit: "per_day",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "canc-mad-02",
      operator_id: "op-mad-shuttle-02",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 12, // 12h antes gratis
      late_cancellation_fee_bps: 4000, // 40%
      no_show_fee_bps: 10000,
      allow_modifications: true,
      modification_window_hours: 1,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    tariffBands: [
      {
        id: "band-mad-02-1d",
        service_id: "srv-mad-shuttle-02",
        source_id: "src-mad-02",
        name: "Estancia 1 Día",
        min_duration_hours: 0,
        max_duration_hours: 24,
        price_amount: 1600, // 16.00 EUR flat
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
        id: "band-mad-02-3d",
        service_id: "srv-mad-shuttle-02",
        source_id: "src-mad-02",
        name: "Estancia Fin de Semana (3 días)",
        min_duration_hours: 25,
        max_duration_hours: 72,
        price_amount: 3200, // 32.00 EUR flat
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
        id: "band-mad-02-7d",
        service_id: "srv-mad-shuttle-02",
        source_id: "src-mad-02",
        name: "Estancia 7 Días",
        min_duration_hours: 73,
        max_duration_hours: 168,
        price_amount: 5200, // 52.00 EUR flat
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
        id: "ext-mad-02-keys",
        facility_id: "fac-mad-shuttle-02",
        service_id: "srv-mad-shuttle-02",
        name: "Llévese sus Llaves (Sin custodia)",
        description: "Opción garantizada de aparcar y llevarse las llaves de su vehículo",
        price_amount: 500, // 5.00 EUR
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
    hasPublishedTariff: false,
    manualConsultationNote: "Operador privado con contratación telefónica exclusiva. Tarifa pública no disponible para fechas seleccionadas.",
    tariffSource: {
      source_id: "src-mad-03",
      source_name: "Ficha Pública Iberpark Barajas",
      source_type: "manual_verified",
      source_url: "https://iberparkbarajas.es/contacto",
      retrieved_at: "2026-10-20T09:00:00Z",
      verification_status: "pending_review",
    },
    facility: {
      id: "fac-mad-manual-03",
      operator_id: "op-mad-manual-03",
      airport_id: MAD_AIRPORT_ID,
      name: "Iberpark Madrid — Custodia Ejecutiva Barajas",
      address: "Carretera de Paracuellos, km 4, 28042 Madrid",
      latitude: 40.5012,
      longitude: -3.5511,
      total_capacity: 80,
      operational_buffer: 5,
      active: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      operator: {
        id: "op-mad-manual-03",
        name: "Iberpark Soluciones S.L.",
        currency: "EUR",
      },
      services: [
        {
          id: "srv-mad-manual-03",
          facility_id: "fac-mad-manual-03",
          name: "Valet Personalizado Flotas",
          description: "Servicio exclusivo corporativo sujeto a confirmación manual de aforo",
          price_amount: 0,
          currency: "EUR",
          pricing_unit: "per_day",
          active: true,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    },
    cancellationPolicy: {
      id: "canc-mad-03",
      operator_id: "op-mad-manual-03",
      legal_document_id: "00000000-0000-4000-b000-000000000003",
      free_cancellation_window_hours: 48,
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

/**
 * Computes authoritative quotes for all operators discovered for an airport.
 * Returns facilities with server_quote, tariff bands, real extras and genuine cancellation policies.
 */
export function getCatalogFacilitiesWithQuotes(
  airportId: string,
  entryAt: string,
  exitAt: string
): {
  verifiedFacilities: FacilityWithServices[];
  manualConsultationFacilities: FacilityWithServices[];
} {
  const verifiedList: FacilityWithServices[] = [];
  const manualList: FacilityWithServices[] = [];

  for (const entry of VERIFIED_DISCOVERED_CATALOG) {
    if (
      airportId &&
      airportId !== "" &&
      entry.facility.airport_id !== airportId &&
      airportId !== "00000000-0000-4000-a000-000000000001" &&
      airportId !== "a0000000-0000-4000-a000-000000000001"
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
        // RangeError or invalid interval: skip
      }
    } else {
      // Operator with manual consultation (no verified published rate)
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

  // Sort verified facilities by server_quote total amount ASCENDING (neutral ranking)
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
