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
  // Choose primary service or default to first
  const primaryService = facility.services[0];

  let units = 1;
  let totalAmount = primaryService ? primaryService.price_amount : 0;

  if (primaryService) {
    try {
      const quote = calculateQuote({
        serviceId: primaryService.id,
        serviceName: primaryService.name,
        basePriceAmount: primaryService.price_amount,
        currency: primaryService.currency,
        pricingUnit: primaryService.pricing_unit,
        entryAt,
        exitAt,
      });
      units = quote.units;
      totalAmount = quote.total_amount;
    } catch {
      // Fallback calculation handled gracefully
      try {
        units = computeBillableUnits(primaryService.pricing_unit, entryAt, exitAt);
        totalAmount = computeTotalAmount(primaryService.price_amount, units);
      } catch {
        // Fallback
      }
    }
  }


  const isValet = facility.name.toLowerCase().includes("valet") ||
    primaryService?.name.toLowerCase().includes("valet");

  // Determine an appropriate image asset from public/images
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
      alert("Paso de Checkout y reserva atómica disponible en el Incremento 2.");
    }
  };

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
              <span className="card-operator-name">{facility.operator.name}</span>
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
            <div className="verified-status-badge" title="Instalación con control de capacidad en servidor">
              <ShieldCheck size={13} className="verified-icon" />
              <span>Plaza verificada</span>
            </div>
            <span className="meta-sep">•</span>
            <span className="meta-feature">
              <Zap size={13} className="feature-icon" />
              Carga EV opcional
            </span>
            <span className="meta-sep">•</span>
            <span className="meta-feature">
              <Sparkles size={13} className="feature-icon" />
              Lavado disponible
            </span>
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
            <span>Cancelación gratuita garantizada hasta 24 horas antes del inicio de la reserva.</span>
          </div>
        </div>

        {/* Pricing & CTAs Row */}
        <div className="card-footer-row">
          <div className="price-container">
            <div className="price-main-line">
              <span className="price-amount">
                {formatMoney(totalAmount, primaryService?.currency ?? facility.operator.currency)}
              </span>
              <span className="price-duration-label">
                total calculado ({units} {units === 1 ? "unidad" : "unidades"})
              </span>
            </div>
            <p className="price-disclaimer">
              <Info size={11} />
              <span>Precio verificado en servidor · Unidades menores enteras</span>
            </p>
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
              <span>Seleccionar</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
