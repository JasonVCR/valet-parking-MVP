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

  // Dynamic Server-authoritative quote calculation with real extras & tariff bands
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
        tariffBands: facility.tariff_bands,
        availableExtras: facility.extras ?? [],
        selectedExtras: selectedInputs,
        tariffSource: facility.server_quote?.tariff_source,
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
                    {formatMoney(quote.customer_total_amount, quote.currency)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Tariff Provenance & Source Verification */}
          {quote?.tariff_source && (
            <div className="detail-info-block tariff-provenance-box">
              <div className="provenance-header">
                <ShieldCheck size={16} className="provenance-icon" />
                <h4 className="block-title">Procedencia y Verificación de la Tarifa</h4>
              </div>
              <div className="provenance-details">
                <p>
                  <strong>Fuente oficial:</strong> {quote.tariff_source.source_name} ({quote.tariff_source.source_type})
                </p>
                {quote.tariff_source.source_url && (
                  <p>
                    <strong>URL verificada:</strong>{" "}
                    <a
                      href={quote.tariff_source.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-legal"
                    >
                      {quote.tariff_source.source_url}
                    </a>
                  </p>
                )}
                <p>
                  <strong>Fecha de captura de tarifa:</strong>{" "}
                  {new Date(quote.tariff_source.retrieved_at).toLocaleString("es-ES", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <div className="provenance-badges">
                  <span className="pill-badge pill-emerald">
                    Estado: {quote.tariff_source.verification_status === "verified" ? "Verificado" : quote.tariff_source.verification_status}
                  </span>
                  <span className="pill-badge pill-slate" title="Integridad técnica verificada">
                    Protocolo SHA-256
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Extras / Add-ons Selector */}
          {facility.extras && facility.extras.length > 0 && (
            <div className="detail-info-block">
              <h4 className="block-title">Servicios complementarios opcionales (Extras)</h4>
              <div className="extras-selection-grid">
                {facility.extras.map((extra) => {
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
          )}

          {/* Cancellation Policy Banner */}
          <div className="cancellation-policy-card">
            <div className="policy-header">
              <ShieldCheck size={18} className="policy-icon" />
              <h5>Política Oficial de Cancelación y Reembolso</h5>
            </div>
            {facility.cancellation_policy ? (
              <ul className="policy-bullets">
                {facility.cancellation_policy.free_cancellation_window_hours > 0 ? (
                  <li>
                    <strong>Cancelación gratuita:</strong> 100% de reembolso si se solicita con al menos {facility.cancellation_policy.free_cancellation_window_hours} horas de antelación al inicio del servicio.
                  </li>
                ) : (
                  <li>
                    <strong>Sin cancelación gratuita:</strong> El operador no admite devoluciones en esta tarifa.
                  </li>
                )}
                {facility.cancellation_policy.late_cancellation_fee_bps > 0 && (
                  <li>
                    <strong>Cancelación con aviso inferior a {facility.cancellation_policy.free_cancellation_window_hours}h:</strong> Penalización del {facility.cancellation_policy.late_cancellation_fee_bps / 100}% por bloqueo de plaza.
                  </li>
                )}
                <li>
                  <strong>No presentación (No-Show):</strong> Penalización del {facility.cancellation_policy.no_show_fee_bps / 100}% (sin reembolso).
                </li>
                {facility.cancellation_policy.allow_modifications && (
                  <li>
                    <strong>Modificaciones de horario:</strong> Gratuitas hasta {facility.cancellation_policy.modification_window_hours} horas antes de la entrada (según disponibilidad).
                  </li>
                )}
              </ul>
            ) : (
              <p className="policy-desc">
                Cancelación sujeta a los términos y condiciones particulares del operador.
              </p>
            )}
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
              {formatMoney(quote?.customer_total_amount ?? 0, primaryService?.currency ?? facility.operator.currency)}
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
