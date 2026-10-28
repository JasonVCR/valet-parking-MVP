"use client";

import React from "react";
import Image from "next/image";
import type { FacilityWithServices, Service } from "@/types/domain";
import {
  computeBillableUnits,
  computeTotalAmount,
  formatMoney,
} from "@/lib/pricing";
import { calculateQuote } from "@/lib/pricing/engine";
import {
  CarFront,
  Bus,
  ShieldCheck,
  Zap,
  Sparkles,
  Check,
  Columns3,
  Eye,
  ArrowRight,
  Info,
} from "./icons";

interface ParkingCardProps {
  facility: FacilityWithServices;
  entryAt: string;
  exitAt: string;
  isCompared?: boolean;
  canCompareMore?: boolean;
  onToggleCompare?: (facilityId: string) => void;
  onViewDetails?: (facility: FacilityWithServices) => void;
  onSelect?: (facility: FacilityWithServices, service: Service) => void;
}

export function ParkingCard({
  facility,
  entryAt,
  exitAt,
  isCompared = false,
  canCompareMore = true,
  onToggleCompare,
  onViewDetails,
  onSelect,
}: ParkingCardProps) {
  const primaryService = facility.services[0];

  // Resolve quote: Prefer server_quote if provided; otherwise fallback to engine
  const quote =
    facility.server_quote ??
    (primaryService
      ? (() => {
          try {
            return calculateQuote({
              serviceId: primaryService.id,
              serviceName: primaryService.name,
              basePriceAmount: primaryService.price_amount,
              currency: primaryService.currency,
              pricingUnit: primaryService.pricing_unit,
              entryAt,
              exitAt,
              tariffBands: facility.tariff_bands,
              availableExtras: facility.extras,
            });
          } catch {
            return null;
          }
        })()
      : null);

  const units = quote
    ? quote.units
    : primaryService
    ? computeBillableUnits(primaryService.pricing_unit, entryAt, exitAt)
    : 1;

  const totalAmount = quote
    ? quote.customer_total_amount
    : primaryService
    ? computeTotalAmount(primaryService.price_amount, units)
    : 0;

  const currency =
    quote?.currency ?? primaryService?.currency ?? facility.operator.currency ?? "EUR";

  // Check if a tariff band was applied
  const tariffBandLine = quote?.breakdown.find(
    (b) => b.type === "supplier_tariff_band"
  );
  const tariffBandLabel = tariffBandLine ? tariffBandLine.label : null;

  // Real operator cancellation policy
  const cancellationText = facility.cancellation_policy
    ? facility.cancellation_policy.free_cancellation_window_hours > 0
      ? `Cancelación gratuita garantizada hasta ${facility.cancellation_policy.free_cancellation_window_hours} horas antes del inicio.`
      : "Tarifa no reembolsable en caso de cancelación del operador."
    : "Cancelación según condiciones del operador.";

  const isValet =
    facility.name.toLowerCase().includes("valet") ||
    primaryService?.name.toLowerCase().includes("valet");

  const heroImage = isValet
    ? "/images/valet_terminal_dropoff_1792282144660.jpg"
    : "/images/covered_parking_facility_1792282144148.jpg";

  const unitLabels: Record<string, string> = {
    per_stay: "estancia",
    per_day: "día",
    per_hour: "hora",
  };

  const handleSelectClick = () => {
    if (onSelect && primaryService) {
      onSelect(facility, primaryService);
    } else {
      alert("Para este operador, contacte directamente con atención al cliente.");
    }
  };

  const isSyntheticDemo =
    facility.id.startsWith("demo-") ||
    quote?.tariff_source?.source_type === "synthetic_seed" ||
    quote?.tariff_source?.source_type === "synthetic_manual";

  const hasOfficialVerifiedTariff =
    !isSyntheticDemo &&
    quote?.tariff_source?.verification_status === "verified";

  const allItemNames = [
    ...facility.services.map((s) => s.name.toLowerCase()),
    ...(facility.extras?.map((e) => e.name.toLowerCase()) ?? []),
  ];
  const hasEvCharge = allItemNames.some((n) =>
    n.includes("eléctric") || n.includes("electric") || n.includes("carga") || n.includes("recarga") || n.includes("ev")
  );
  const hasWash = allItemNames.some((n) =>
    n.includes("lavado") || n.includes("limpieza") || n.includes("wash")
  );

  return (
    <article
      className={`parking-card ${isCompared ? "card-compared" : ""}`}
      aria-labelledby={`facility-heading-${facility.id}`}
    >
      {/* Media Column */}
      <div className="card-media-col">
        <div className="card-img-wrapper">
          <Image
            src={heroImage}
            alt={facility.name}
            fill
            sizes="(max-width: 768px) 100vw, 300px"
            className="card-img"
          />
          <div className="media-tag-modality">
            {isValet ? <CarFront size={13} /> : <Bus size={13} />}
            <span>{isValet ? "Valet en Terminal" : "Lanzadera Shuttle"}</span>
          </div>
          <div className="media-tag-security">
            <span>Recinto Vigilado 24h</span>
          </div>
        </div>
      </div>

      {/* Content Column */}
      <div className="card-content-col">
        <div className="card-body">
          {/* Header row: title, operator, compare button */}
          <div className="card-header-row">
            <div>
              <div className="operator-header-line">
                <span className="card-operator-name">{facility.operator.name}</span>
                {tariffBandLabel && (
                  <span className="tariff-band-badge" title="Tarifa por tramo fijo publicada por el operador">
                    {tariffBandLabel}
                  </span>
                )}
              </div>
              <h3 id={`facility-heading-${facility.id}`} className="card-title">
                {facility.name}
              </h3>
              <p className="card-address">
                📍 {facility.address}
              </p>
            </div>

            {onToggleCompare && (
              <button
                type="button"
                onClick={() => onToggleCompare(facility.id)}
                disabled={!isCompared && !canCompareMore}
                className={`compare-toggle-btn ${isCompared ? "active" : ""}`}
                title={
                  isCompared
                    ? "Quitar de la comparativa"
                    : canCompareMore
                    ? "Añadir a la comparativa (máx. 3)"
                    : "Límite máximo alcanzado (3 parkings)"
                }
                aria-label={
                  isCompared
                    ? `Quitar ${facility.name} de la comparativa`
                    : `Añadir ${facility.name} a la comparativa`
                }
              >
                <Columns3 size={13} />
                <span>{isCompared ? "En comparador" : "Comparar"}</span>
              </button>
            )}
          </div>

          {/* Highlights & Ratings */}
          <div className="card-meta-row">
            {isSyntheticDemo ? (
              <div className="meta-demo-badge" title="Instalación de demostración en entorno sandbox (datos de prueba)">
                <Info size={13} />
                <span>Catálogo Demo</span>
              </div>
            ) : (
              <div className="verified-status-badge" title="Instalación real con capacidad supervisada en servidor">
                <ShieldCheck size={13} className="verified-icon" />
                <span>Plaza verificada</span>
              </div>
            )}

            {hasOfficialVerifiedTariff ? (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-feature meta-source" title={`Tarifa oficial verificada (${quote?.tariff_source?.source_url ?? quote?.tariff_source?.source_name})`}>
                  Tarifa oficial verificada
                </span>
              </>
            ) : isSyntheticDemo ? (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-feature meta-demo-source" title="Tarifa simulada con datos sintéticos no contractuales">
                  Tarifa de demostración (demo)
                </span>
              </>
            ) : (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-feature meta-unverified" title="Tarifa estándar pendiente de verificación oficial">
                  Tarifa pendiente de verificación
                </span>
              </>
            )}

            {hasEvCharge && (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-feature">
                  <Zap size={13} className="feature-icon" />
                  Carga EV disponible
                </span>
              </>
            )}

            {hasWash && (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-feature">
                  <Sparkles size={13} className="feature-icon" />
                  Lavado disponible
                </span>
              </>
            )}
          </div>

          {/* Services list */}
          <div className="included-services-grid">
            {facility.services.slice(0, 3).map((srv) => (
              <div key={srv.id} className="service-bullet">
                <Check size={13} className="check-icon" />
                <span className="service-bullet-text">
                  {srv.name} ({formatMoney(srv.price_amount, srv.currency)}/{unitLabels[srv.pricing_unit] ?? srv.pricing_unit})
                </span>
              </div>
            ))}
          </div>

          {/* Cancellation Policy Banner */}
          <div className="cancellation-policy-box">
            <ShieldCheck size={14} className="shield-icon" />
            <span>{cancellationText}</span>
          </div>
        </div>

        {/* Pricing & CTAs Row */}
        <div className="card-footer-row">
          <div className="price-container">
            {quote ? (
              <>
                <div className="price-main-line">
                  <span className="price-amount">
                    {formatMoney(totalAmount, currency)}
                  </span>
                  <span className="price-duration-label">
                    total calculado ({units} {units === 1 ? "unidad" : "unidades"})
                  </span>
                </div>
                {/* AeroValet transparent fee breakdown line */}
                <div className="fee-breakdown-subline">
                  <span className="fee-item">Base: {formatMoney(quote.supplier_base_amount, currency)}</span>
                  <span className="fee-sep">+</span>
                  <span className="fee-item fee-aerovalet" title="Margen AeroValet (8,00 €) + Gestión (1,99 €)">
                    AeroValet: {formatMoney(quote.platform_markup_amount + quote.booking_management_fee_amount, currency)}
                  </span>
                </div>
                <p className="price-disclaimer">
                  <Info size={11} />
                  <span>Precio verificado en servidor · Unidades menores enteras</span>
                </p>
              </>
            ) : (
              <div className="price-manual-consultation">
                <span className="price-amount price-consult-text">Bajo consulta</span>
                <p className="price-disclaimer">
                  <Info size={11} />
                  <span>Tarifa sujeta a confirmación manual del operador</span>
                </p>
              </div>
            )}
          </div>

          <div className="card-actions-group">
            {onViewDetails && (
              <button
                type="button"
                onClick={() => onViewDetails(facility)}
                className="btn-details"
                aria-label={`Ver detalles de ${facility.name}`}
              >
                <Eye size={13} />
                <span>Detalles</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSelectClick}
              className="btn-select"
              aria-label={`Seleccionar ${facility.name}`}
            >
              <span>{quote ? "Seleccionar" : "Consultar"}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
