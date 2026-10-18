"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import type { FacilityWithServices } from "@/types/domain";
import {
  computeBillableUnits,
  computeTotalAmount,
  formatMoney,
} from "@/lib/pricing";
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
} from "./icons";

interface ParkingDetailModalProps {
  facility: FacilityWithServices | null;
  entryAt: string;
  exitAt: string;
  onClose: () => void;
  onProceed: (facility: FacilityWithServices) => void;
}

export function ParkingDetailModal({
  facility,
  entryAt,
  exitAt,
  onClose,
  onProceed,
}: ParkingDetailModalProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!facility) return null;

  const isValet = facility.name.toLowerCase().includes("valet");
  const gallery = [
    isValet
      ? "/images/valet_terminal_dropoff_1792282144660.jpg"
      : "/images/covered_parking_facility_1792282144148.jpg",
    "/images/express_shuttle_service_1792282145261.jpg",
    "/images/parking_aerial_overview_1792282144729.jpg",
  ];

  const primaryService = facility.services[0];
  let units = 1;
  let totalAmount = primaryService ? primaryService.price_amount : 0;

  if (primaryService) {
    try {
      units = computeBillableUnits(primaryService.pricing_unit, entryAt, exitAt);
      totalAmount = computeTotalAmount(primaryService.price_amount, units);
    } catch {
      // fallback
    }
  }

  const unitLabels: Record<string, string> = {
    per_stay: "estancia",
    per_day: "día",
    per_hour: "hora",
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
                Operador: {facility.operator.name}
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

          {/* Service Information */}
          <div className="detail-info-block">
            <h4 className="block-title">Servicios incluidos en esta instalación</h4>
            <div className="services-grid-detail">
              {facility.services.map((srv) => (
                <div key={srv.id} className="srv-detail-card">
                  <div className="srv-card-top">
                    <span className="srv-name">{srv.name}</span>
                    <span className="srv-price-badge">
                      {formatMoney(srv.price_amount, srv.currency)}/{unitLabels[srv.pricing_unit] ?? srv.pricing_unit}
                    </span>
                  </div>
                  {srv.description && (
                    <p className="srv-desc">{srv.description}</p>
                  )}
                  <div className="srv-badge-verified">
                    <Check size={12} />
                    <span>Servicio verificado en base de datos</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Operational Guarantees */}
          <div className="detail-guarantees-grid">
            <div className="guarantee-card">
              <ShieldCheck size={20} className="guarantee-icon" />
              <div>
                <h5>Capacidad y Bloqueo Atómico</h5>
                <p>
                  Tu plaza se bloquea con hold temporal garantizado por la base de datos para evitar sobreventa.
                </p>
              </div>
            </div>

            <div className="guarantee-card">
              <Sparkles size={20} className="guarantee-icon" />
              <div>
                <h5>Cancelación Gratuita</h5>
                <p>
                  Reembolso completo garantizado cancelando hasta 24 horas antes del inicio de tu estancia.
                </p>
              </div>
            </div>
          </div>

          {/* Validation disclaimer */}
          <div className="pending-validation-notice">
            <Info size={14} />
            <div>
              <strong>Aviso de transparencia:</strong> Los datos operativos, coberturas de seguro y cámaras CCTV están sujetos a las cláusulas del contrato de cada operador adherido al marketplace.
            </div>
          </div>
        </div>

        {/* Modal Footer / Checkout CTA */}
        <div className="modal-footer">
          <div className="footer-price-info">
            <span className="footer-price-label">Total estimado de la estancia:</span>
            <span className="footer-price-val">
              {formatMoney(totalAmount, primaryService?.currency ?? facility.operator.currency)}
            </span>
            <span className="footer-price-units">
              ({units} {units === 1 ? "unidad" : "unidades"})
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
              onClick={() => onProceed(facility)}
              className="btn-modal-proceed"
            >
              <span>Continuar con la reserva</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
