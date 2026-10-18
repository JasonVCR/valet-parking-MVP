"use client";

import React, { useEffect } from "react";
import Image from "next/image";
import type { FacilityWithServices } from "@/types/domain";
import {
  computeBillableUnits,
  computeTotalAmount,
  formatMoney,
} from "@/lib/pricing";
import {
  X,
  Check,
  ShieldCheck,
  Star,
  Zap,
  Sparkles,
  ArrowRight,
  CarFront,
  Bus,
  Trash2,
  Info,
} from "./icons";

interface ComparisonModalProps {
  facilities: FacilityWithServices[];
  entryAt: string;
  exitAt: string;
  onClose: () => void;
  onRemoveFacility: (id: string) => void;
  onSelectFacility: (facility: FacilityWithServices) => void;
}

export function ComparisonModal({
  facilities,
  entryAt,
  exitAt,
  onClose,
  onRemoveFacility,
  onSelectFacility,
}: ComparisonModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (facilities.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-title"
      className="modal-backdrop"
    >
      <div className="modal-container comparison-modal-box">
        {/* Modal Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title-row">
              <h3 id="comparison-title" className="modal-title">
                Comparativa de Parkings lado a lado
              </h3>
              <span className="badge-counter">
                {facilities.length} de 3 seleccionados
              </span>
            </div>
            <p className="modal-subtitle">
              Compara precios calculados en servidor, modalidades, ubicación y servicios incluidos.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Cerrar comparativa"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Table Body */}
        <div className="modal-body-scrollable">
          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th className="th-label">Aparcamiento</th>
                  {facilities.map((f) => {
                    const isValet = f.name.toLowerCase().includes("valet");
                    const img = isValet
                      ? "/images/valet_terminal_dropoff_1792282144660.jpg"
                      : "/images/covered_parking_facility_1792282144148.jpg";

                    return (
                      <th key={f.id} className="th-facility">
                        <div className="table-facility-head">
                          <div className="th-img-box">
                            <Image
                              src={img}
                              alt={f.name}
                              fill
                              sizes="200px"
                              className="th-img"
                            />
                            <button
                              type="button"
                              onClick={() => onRemoveFacility(f.id)}
                              className="th-remove-btn"
                              title={`Eliminar ${f.name} de la comparativa`}
                              aria-label={`Eliminar ${f.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <span className="th-operator-name">{f.operator.name}</span>
                          <h4 className="th-title">{f.name}</h4>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {/* Modality */}
                <tr>
                  <td className="td-label">Modalidad</td>
                  {facilities.map((f) => {
                    const isValet = f.name.toLowerCase().includes("valet");
                    return (
                      <td key={f.id} className="td-val">
                        <span className={`pill-badge ${isValet ? "pill-blue" : "pill-emerald"}`}>
                          {isValet ? <CarFront size={13} /> : <Bus size={13} />}
                          <span>{isValet ? "Valet en Terminal" : "Lanzadera Shuttle"}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>

                {/* Total Price (server-calculated cents) */}
                <tr className="highlight-row">
                  <td className="td-label">Precio total estimado</td>
                  {facilities.map((f) => {
                    const srv = f.services[0];
                    let total = srv ? srv.price_amount : 0;
                    let units = 1;
                    if (srv) {
                      try {
                        units = computeBillableUnits(srv.pricing_unit, entryAt, exitAt);
                        total = computeTotalAmount(srv.price_amount, units);
                      } catch {
                        // fallback
                      }
                    }
                    return (
                      <td key={f.id} className="td-val">
                        <div className="table-price-box">
                          <span className="table-price-amount">
                            {formatMoney(total, srv?.currency ?? f.operator.currency)}
                          </span>
                          <span className="table-price-sub">
                            ({units} {units === 1 ? "unidad" : "unidades"})
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Base rate / cadence */}
                <tr>
                  <td className="td-label">Tarifa base</td>
                  {facilities.map((f) => {
                    const srv = f.services[0];
                    return (
                      <td key={f.id} className="td-val">
                        {srv
                          ? `${formatMoney(srv.price_amount, srv.currency)} / ${srv.pricing_unit}`
                          : "No especificado"}
                      </td>
                    );
                  })}
                </tr>

                {/* Location / Address */}
                <tr>
                  <td className="td-label">Dirección</td>
                  {facilities.map((f) => (
                    <td key={f.id} className="td-val">
                      📍 {f.address}
                    </td>
                  ))}
                </tr>

                {/* Services included */}
                <tr>
                  <td className="td-label">Servicios incluidos</td>
                  {facilities.map((f) => (
                    <td key={f.id} className="td-val">
                      <div className="table-services-list">
                        {f.services.map((srv) => (
                          <div key={srv.id} className="table-srv-item">
                            <Check size={12} className="check-icon" />
                            <span>{srv.name}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Security and features */}
                <tr>
                  <td className="td-label">Seguridad y Garantías</td>
                  {facilities.map((f) => (
                    <td key={f.id} className="td-val">
                      <div className="table-features-box">
                        <span className="feature-item">
                          <ShieldCheck size={13} className="shield-icon" />
                          Capacidad atómica bloqueada
                        </span>
                        <span className="feature-item">
                          <Check size={13} className="check-icon" />
                          Cancelación gratuita hasta 24h
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Select CTA */}
                <tr>
                  <td className="td-label">Acción</td>
                  {facilities.map((f) => (
                    <td key={f.id} className="td-val">
                      <button
                        type="button"
                        onClick={() => onSelectFacility(f)}
                        className="btn-select-table"
                      >
                        <span>Seleccionar</span>
                        <ArrowRight size={13} />
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
