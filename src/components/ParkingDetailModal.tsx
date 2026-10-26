"use client";

import React, { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import type { FacilityWithServices, SelectedExtraInput, ServiceExtra } from "@/types/domain";
import { formatMoney } from "@/lib/pricing";
import { calculateQuote } from "@/lib/pricing/engine";
import {
  PLATFORM_TERMS_DOCUMENT,
  PRIVACY_POLICY_DOCUMENT,
  CANCELLATION_POLICY_DOCUMENT,
} from "@/data/legalDocuments";
import {
  X,
  ShieldCheck,
  MapPin,
  Check,
  ArrowRight,
  Camera,
  Sparkles,
  Info,
  CarFront,
  Bus,
  Zap,
} from "./icons";

interface ParkingDetailModalProps {
  facility: FacilityWithServices | null;
  entryAt: string;
  exitAt: string;
  onClose: () => void;
  onProceed: (facility: FacilityWithServices, selectedExtras: SelectedExtraInput[]) => void;
}

// Representative available extras for the facility
const FACILITY_SAMPLE_EXTRAS: ServiceExtra[] = [
  {
    id: "e0000000-0000-4000-c000-000000000001",
    facility_id: "",
    service_id: null,
    name: "Lavado Exterior a Mano",
    description: "Limpieza integral de carrocería y llantas a mano antes de la entrega",
    price_amount: 1900, // 19.00 EUR
    currency: "EUR",
    pricing_unit: "per_stay",
    is_mandatory: false,
    max_quantity: 1,
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "e0000000-0000-4000-c000-000000000002",
    facility_id: "",
    service_id: null,
    name: "Recarga Inteligente para Vehículo Eléctrico (VE)",
    description: "Carga garantizada hasta el 80% o 100% de batería antes de la recogida",
    price_amount: 2500, // 25.00 EUR
    currency: "EUR",
    pricing_unit: "per_stay",
    is_mandatory: false,
    max_quantity: 1,
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "e0000000-0000-4000-c000-000000000003",
    facility_id: "",
    service_id: null,
    name: "Custodia Segura de Llaves en Caja Fuerte",
    description: "Almacenamiento blindado con trazabilidad biométrica de operarios",
    price_amount: 350, // 3.50 EUR
    currency: "EUR",
    pricing_unit: "per_stay",
    is_mandatory: false,
    max_quantity: 1,
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
];

export function ParkingDetailModal({
  facility,
  entryAt,
  exitAt,
  onClose,
  onProceed,
}: ParkingDetailModalProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState<"terms" | "privacy" | "cancellation" | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showTermsModal) {
          setShowTermsModal(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, showTermsModal]);

  const primaryService = facility?.services[0];

  // Dynamic Server-authoritative quote calculation
  const quote = useMemo(() => {
    if (!facility || !primaryService) return null;

    const selectedInputs: SelectedExtraInput[] = selectedExtraIds.map((id) => ({
      extra_id: id,
      quantity: 1,
    }));

    try {
      return calculateQuote({
        serviceId: primaryService.id,
        serviceName: primaryService.name,
        basePriceAmount: primaryService.price_amount,
        currency: primaryService.currency,
        pricingUnit: primaryService.pricing_unit,
        entryAt,
        exitAt,
        availableExtras: FACILITY_SAMPLE_EXTRAS,
        selectedExtras: selectedInputs,
      });
    } catch {
      return null;
    }
  }, [facility, primaryService, entryAt, exitAt, selectedExtraIds]);

  if (!facility) return null;

  const isValet = facility.name.toLowerCase().includes("valet");
  const gallery = [
    isValet
      ? "/images/valet_terminal_dropoff_1792282144660.jpg"
      : "/images/covered_parking_facility_1792282144148.jpg",
    "/images/express_shuttle_service_1792282145261.jpg",
    "/images/parking_aerial_overview_1792282144729.jpg",
  ];

  const handleToggleExtra = (extraId: string) => {
    setSelectedExtraIds((prev) =>
      prev.includes(extraId) ? prev.filter((id) => id !== extraId) : [...prev, extraId]
    );
  };

  const handleProceedClick = () => {
    if (!termsAccepted || !privacyAccepted) return;
    const selectedInputs: SelectedExtraInput[] = selectedExtraIds.map((id) => ({
      extra_id: id,
      quantity: 1,
    }));
    onProceed(facility, selectedInputs);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      className="modal-backdrop"
    >
      <div className="modal-container detail-modal-box">
        {/* Modal Top Bar */}
        <div className="modal-header">
          <div>
            <div className="modal-badge-row">
              <span className={`pill-badge ${isValet ? "pill-blue" : "pill-emerald"}`}>
                {isValet ? <CarFront size={13} /> : <Bus size={13} />}
                <span>{isValet ? "Valet en Terminal" : "Lanzadera Shuttle"}</span>
              </span>
              <span className="pill-badge pill-slate">
                Operador autorizado: {facility.operator.name}
              </span>
            </div>
            <h3 id="detail-title" className="modal-title">
              {facility.name}
            </h3>
            <p className="modal-address">
              <MapPin size={13} />
              <span>{facility.address}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Cerrar ventana de detalle"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body-scrollable">
          {/* Gallery Showcase */}
          <div className="detail-gallery-section">
            <div className="gallery-main-viewer">
              <Image
                src={gallery[activeImageIndex]}
                alt={`${facility.name} vista ${activeImageIndex + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 800px"
                className="gallery-main-img"
              />
              <div className="gallery-counter-badge">
                <Camera size={13} />
                <span>Foto {activeImageIndex + 1} de {gallery.length}</span>
              </div>
            </div>

            {/* Thumbnails */}
            <div className="gallery-thumbnails-row">
              {gallery.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  className={`thumb-btn ${activeImageIndex === idx ? "active" : ""}`}
                >
                  <Image
                    src={img}
                    alt={`Miniatura ${idx + 1}`}
                    width={80}
                    height={56}
                    className="thumb-img"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Pricing Itemized Breakdown */}
          {quote && (
            <div className="detail-info-block pricing-breakdown-box">
              <h4 className="block-title">Desglose transparente del precio</h4>
              <div className="breakdown-lines-list">
                {quote.breakdown.map((line, idx) => (
                  <div key={idx} className="breakdown-line-row">
                    <span className="breakdown-label">{line.label}</span>
                    <span className="breakdown-amount">
                      {formatMoney(line.total_price, quote.currency)}
                    </span>
                  </div>
                ))}
                <div className="breakdown-total-row">
                  <strong>Total final garantizado:</strong>
                  <strong className="total-val">
                    {formatMoney(quote.total_amount, quote.currency)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Extras / Add-ons Selector */}
          <div className="detail-info-block">
            <h4 className="block-title">Servicios complementarios opcionales (Extras)</h4>
            <div className="extras-selection-grid">
              {FACILITY_SAMPLE_EXTRAS.map((extra) => {
                const isSelected = selectedExtraIds.includes(extra.id);
                return (
                  <div
                    key={extra.id}
                    onClick={() => handleToggleExtra(extra.id)}
                    className={`extra-selectable-card ${isSelected ? "selected" : ""}`}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                  >
                    <div className="extra-checkbox-col">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // handled by parent onClick
                        className="extra-checkbox"
                        aria-label={`Seleccionar ${extra.name}`}
                      />
                    </div>
                    <div className="extra-info-col">
                      <div className="extra-top-line">
                        <span className="extra-name">{extra.name}</span>
                        <span className="extra-price-tag">
                          +{formatMoney(extra.price_amount, extra.currency)}
                        </span>
                      </div>
                      {extra.description && (
                        <p className="extra-desc">{extra.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cancellation Policy Banner */}
          <div className="cancellation-policy-card">
            <div className="policy-header">
              <ShieldCheck size={18} className="policy-icon" />
              <h5>Política Oficial de Cancelación y Reembolso</h5>
            </div>
            <ul className="policy-bullets">
              <li>
                <strong>Cancelación gratuita:</strong> 100% de reembolso si se solicita con al menos 24 horas de antelación al inicio del servicio.
              </li>
              <li>
                <strong>Cancelación con aviso inferior a 24h:</strong> Penalización del 50% por bloqueo de plaza; reembolso del 50% restante.
              </li>
              <li>
                <strong>No presentación (No-Show):</strong> Sin reembolso (100% penalización).
              </li>
              <li>
                <strong>Modificaciones de horario:</strong> Gratuitas hasta 2 horas antes de la entrada (según disponibilidad).
              </li>
            </ul>
          </div>

          {/* Legal Acceptances (Unchecked checkboxes by default) */}
          <div className="legal-acceptances-box">
            <h5 className="legal-box-title">Condiciones contractuales y privacidad</h5>
            <div className="acceptance-field">
              <input
                type="checkbox"
                id="accept-terms"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="acceptance-checkbox"
              />
              <label htmlFor="accept-terms" className="acceptance-label">
                He leído y acepto expresamente los{" "}
                <button
                  type="button"
                  onClick={() => setShowTermsModal("terms")}
                  className="link-legal"
                >
                  Términos de AeroValet (v{PLATFORM_TERMS_DOCUMENT.version})
                </button>{" "}
                y las condiciones de contratación del operador <strong>{facility.operator.name}</strong>.
              </label>
            </div>

            <div className="acceptance-field">
              <input
                type="checkbox"
                id="accept-privacy"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                className="acceptance-checkbox"
              />
              <label htmlFor="accept-privacy" className="acceptance-label">
                He leído la{" "}
                <button
                  type="button"
                  onClick={() => setShowTermsModal("privacy")}
                  className="link-legal"
                >
                  Política de Privacidad (v{PRIVACY_POLICY_DOCUMENT.version})
                </button>{" "}
                y autorizo el tratamiento de mis datos de contacto para la gestión de la reserva y control de acceso.
              </label>
            </div>
          </div>

          {/* Validation disclaimer */}
          <div className="pending-validation-notice">
            <Info size={14} />
            <div>
              <strong>Aviso de transparencia:</strong> Los datos y condiciones contractuales quedan registrados inmutablemente en el servidor bajo protocolo SHA-256 en el momento de crear la reserva.
            </div>
          </div>
        </div>

        {/* Modal Footer / Checkout CTA */}
        <div className="modal-footer">
          <div className="footer-price-info">
            <span className="footer-price-label">Total de la estancia:</span>
            <span className="footer-price-val">
              {formatMoney(quote?.total_amount ?? 0, primaryService?.currency ?? facility.operator.currency)}
            </span>
            <span className="footer-price-units">
              ({quote?.units ?? 1} {(quote?.units ?? 1) === 1 ? "unidad" : "unidades"})
            </span>
          </div>

          <div className="footer-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn-modal-cancel"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleProceedClick}
              disabled={!termsAccepted || !privacyAccepted}
              className={`btn-modal-proceed ${(!termsAccepted || !privacyAccepted) ? "disabled" : ""}`}
              title={
                !termsAccepted || !privacyAccepted
                  ? "Debe marcar las casillas obligatorias de condiciones y privacidad para continuar"
                  : "Proceder con el bloqueo de plaza en el servidor"
              }
            >
              <span>Continuar con la reserva</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Submodal for Legal Reading */}
      {showTermsModal && (
        <div className="modal-backdrop submodal-backdrop">
          <div className="modal-container legal-reader-box">
            <div className="modal-header">
              <h3>
                {showTermsModal === "terms"
                  ? PLATFORM_TERMS_DOCUMENT.title
                  : showTermsModal === "privacy"
                  ? PRIVACY_POLICY_DOCUMENT.title
                  : CANCELLATION_POLICY_DOCUMENT.title}
              </h3>
              <button
                type="button"
                onClick={() => setShowTermsModal(null)}
                className="modal-close-btn"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body-scrollable legal-text-scroll">
              <pre className="legal-markdown-view">
                {showTermsModal === "terms"
                  ? PLATFORM_TERMS_DOCUMENT.content_markdown
                  : showTermsModal === "privacy"
                  ? PRIVACY_POLICY_DOCUMENT.content_markdown
                  : CANCELLATION_POLICY_DOCUMENT.content_markdown}
              </pre>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setShowTermsModal(null)}
                className="btn-modal-proceed"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
