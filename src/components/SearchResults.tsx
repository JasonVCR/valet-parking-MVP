"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import type { FacilityWithServices, Airport } from "@/types/domain";
import { ParkingCard } from "./ParkingCard";
import { ComparisonBar } from "./ComparisonBar";
import { ComparisonModal } from "./ComparisonModal";
import { ParkingDetailModal } from "./ParkingDetailModal";
import { FaqSection } from "./FaqSection";
import { createBookingHoldAction } from "@/server/bookingHolds";
import { formatMoney } from "@/lib/pricing";

import {
  SlidersHorizontal,
  CarFront,
  Bus,
  RotateCcw,
  AlertCircle,
  Info,
} from "./icons";


interface SearchResultsProps {
  facilities: FacilityWithServices[];
  manualFacilities?: FacilityWithServices[];
  airport: Airport | null;
  entryAt: string;
  exitAt: string;
  isDemoMode?: boolean;
  errorMessage?: string;
}

export function SearchResults({
  facilities,
  manualFacilities = [],
  airport,
  entryAt,
  exitAt,
  isDemoMode = false,
  errorMessage,
}: SearchResultsProps) {
  // Modality filter: 'all' | 'valet' | 'shuttle'
  const [modalityFilter, setModalityFilter] = useState<"all" | "valet" | "shuttle">("all");
  // Sort option: 'price_asc' | 'popularity'
  const [sortBy, setSortBy] = useState<"price_asc" | "name_asc">("price_asc");

  // Comparison state
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);

  // Detail Modal state
  const [detailFacility, setDetailFacility] = useState<FacilityWithServices | null>(null);

  // Notice alert
  const [bookingNotice, setBookingNotice] = useState<string | null>(null);

  // Filtered and sorted list
  const filteredFacilities = useMemo(() => {
    let list = [...facilities];

    if (modalityFilter === "valet") {
      list = list.filter((f) =>
        f.name.toLowerCase().includes("valet") ||
        f.services.some((s) => s.name.toLowerCase().includes("valet"))
      );
    } else if (modalityFilter === "shuttle") {
      list = list.filter((f) =>
        f.name.toLowerCase().includes("shuttle") ||
        f.name.toLowerCase().includes("lanzadera") ||
        !f.name.toLowerCase().includes("valet")
      );
    }

    if (sortBy === "price_asc") {
      list.sort((a, b) => {
        const pA = a.server_quote?.customer_total_amount ?? a.services[0]?.price_amount ?? Infinity;
        const pB = b.server_quote?.customer_total_amount ?? b.services[0]?.price_amount ?? Infinity;
        return pA - pB;
      });
    } else if (sortBy === "name_asc") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [facilities, modalityFilter, sortBy]);

  const comparedFacilities = useMemo(() => {
    return facilities.filter((f) => comparisonIds.includes(f.id));
  }, [facilities, comparisonIds]);

  const handleToggleCompare = (id: string) => {
    setComparisonIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      if (prev.length >= 3) {
        alert("Puedes comparar hasta 3 parkings simultáneamente.");
        return prev;
      }
      return [...prev, id];
    });
  };

  const [isHolding, setIsHolding] = useState(false);

  const handleSelectFacility = async (
    facility: FacilityWithServices,
    selectedExtras?: { extra_id: string; quantity: number }[]
  ) => {
    const srv = facility.services[0];
    if (!srv) {
      setBookingNotice(`La instalación ${facility.name} no cuenta con servicios activos.`);
      return;
    }

    setIsHolding(true);
    setBookingNotice("Solicitando asignación de plaza, extras y bloqueo de capacidad en el servidor...");

    try {
      const res = await createBookingHoldAction({
        facility_id: facility.id,
        service_id: srv.id,
        entry_at: entryAt,
        exit_at: exitAt,
        guest_name: "Cliente Invitado",
        guest_email: "cliente.invitado@aerovalet.demo",
        selected_extras: selectedExtras ?? [],
      });

      if (res.success && res.hold) {
        const formatted = formatMoney(res.hold.price_amount, res.hold.currency);
        const exp = new Date(res.hold.expires_at).toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const extrasCount = selectedExtras?.length ?? 0;
        setBookingNotice(
          `${res.isDemo ? "🧪 [Simulación Demo] " : "🔒 "}Plaza bloqueada temporalmente en servidor para "${facility.name}". Hold: ${res.hold.hold_id.slice(0, 18)}... (vigente hasta las ${exp}). Tarifa total: ${formatted} (${res.hold.units} ${res.hold.units === 1 ? "unidad" : "unidades"}${extrasCount > 0 ? ` + ${extrasCount} ${extrasCount === 1 ? "extra" : "extras"}` : ""}). Cancelación gratuita hasta 24h antes.`
        );
      } else {
        setBookingNotice(`No se pudo reservar la plaza: ${res.error || "Capacidad no disponible"}`);
      }
    } catch {
      setBookingNotice("Error al comunicar con el servidor para la reserva temporal.");
    } finally {
      setIsHolding(false);
    }
  };

  const entryDate = new Date(entryAt);
  const exitDate = new Date(exitAt);
  const diffHours = Math.round(
    (exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60)
  );
  const diffDays = Math.ceil(diffHours / 24);

  return (
    <div className="search-results-page">
      {/* Header bar */}
      <section className="search-header-panel">
        <div className="results-container">
          <div className="search-summary-nav">
            <Link href="/" className="back-to-search-btn">
              ← Modificar fechas o aeropuerto
            </Link>
          </div>

          <div className="results-title-row">
            <div>
              <h1 className="results-main-title">
                Aparcamientos en {airport ? airport.name : "Aeropuerto"}
              </h1>
              <p className="results-main-sub">
                Precios calculados en servidor para {diffDays} {diffDays === 1 ? "día" : "días"} ({diffHours}h).
              </p>
            </div>

            <div className="results-chips-bar">
              <div className="summary-chip">
                <span className="chip-label">Aeropuerto</span>
                <span className="chip-val">
                  {airport ? `${airport.iata_code} · ${airport.city}` : "N/D"}
                </span>
              </div>
              <div className="summary-chip">
                <span className="chip-label">Entrada</span>
                <span className="chip-val">
                  {entryDate.toLocaleString("es-ES", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <div className="summary-chip">
                <span className="chip-label">Salida</span>
                <span className="chip-val">
                  {exitDate.toLocaleString("es-ES", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main content container */}
      <div className="results-container main-content-wrapper">
        {/* Loading hold indicator */}
        {isHolding && (
          <div className="booking-notice-banner" role="status">
            <div className="notice-content">
              <strong>⏳ Conectando con servidor:</strong> Verificando aforo en PostgreSQL y reservando plaza temporal...
            </div>
          </div>
        )}

        {/* Booking hold notification banner */}
        {bookingNotice && !isHolding && (
          <div className="booking-notice-banner" role="status">
            <div className="notice-content">
              <strong>🎉 Paso de selección completado:</strong> {bookingNotice}
            </div>
            <button
              type="button"
              onClick={() => setBookingNotice(null)}
              className="notice-close"
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        )}


        {/* Demo Mode Notice */}
        {isDemoMode && (
          <div className="demo-banner mb-6" role="status">
            <span className="demo-icon">🔬</span>
            <div>
              <strong>Modo catálogo de mercado activo:</strong> Mostrando tarifas oficiales auditadas con bandas fijas y procedencia verificada. En este entorno demostrativo sin conexión a Supabase de producción, las solicitudes de reserva se gestionan de forma simulada y segura.
            </div>
          </div>
        )}

        {/* Error Notice */}
        {errorMessage && (
          <div className="alert-card alert-error mb-6" role="alert">
            <AlertCircle size={18} />
            <div>
              <h3>Error consultando instalaciones</h3>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Filter and sorting toolbar */}
        {facilities.length > 0 && (
          <div className="results-toolbar">
            <div className="modality-filter-group">
              <span className="toolbar-label">
                <SlidersHorizontal size={14} />
                Modalidad:
              </span>
              <button
                type="button"
                onClick={() => setModalityFilter("all")}
                className={`filter-tab ${modalityFilter === "all" ? "active" : ""}`}
              >
                Todas ({facilities.length})
              </button>
              <button
                type="button"
                onClick={() => setModalityFilter("valet")}
                className={`filter-tab ${modalityFilter === "valet" ? "active" : ""}`}
              >
                <CarFront size={13} />
                Valet en Terminal
              </button>
              <button
                type="button"
                onClick={() => setModalityFilter("shuttle")}
                className={`filter-tab ${modalityFilter === "shuttle" ? "active" : ""}`}
              >
                <Bus size={13} />
                Lanzadera Shuttle
              </button>
            </div>

            <div className="sort-filter-group">
              <label htmlFor="sort-select" className="toolbar-label">
                Ordenar por:
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "price_asc" | "name_asc")}
                className="sort-dropdown"
              >
                <option value="price_asc">Precio más bajo primero</option>
                <option value="name_asc">Nombre del parking</option>
              </select>
            </div>
          </div>
        )}

        {/* Ranking Transparency Note */}
        {facilities.length > 0 && (
          <div className="ranking-transparency-note" role="note">
            <Info size={13} />
            <span>
              <strong>Criterio de clasificación neutral:</strong> Los resultados se ordenan exclusivamente por{" "}
              {sortBy === "price_asc" ? "precio total íntegro para las fechas elegidas" : "orden alfabético"}. AeroValet no aplica subastas de pujas, comisiones preferentes ni posicionamientos pagados.
            </span>
          </div>
        )}

        {/* Results Cards List or Empty State */}
        {filteredFacilities.length === 0 ? (
          <div className="empty-results-box">
            <div className="empty-results-icon">🚗</div>
            <h2>No se encontraron aparcamientos para estas fechas</h2>
            <p>
              {isDemoMode
                ? "En modo demostración local sin base de datos Supabase conectada, la lista de aparcamientos permanece vacía de forma transparente."
                : "No hay plazas o instalaciones activas para este aeropuerto en las fechas seleccionadas."}
            </p>
            <div className="empty-actions">
              <Link href="/" className="btn-new-search">
                <RotateCcw size={14} />
                <span>Modificar búsqueda</span>
              </Link>
            </div>
          </div>
        ) : (
          <section className="parkings-grid" aria-label="Listado de parkings">
            {filteredFacilities.map((facility) => (
              <ParkingCard
                key={facility.id}
                facility={facility}
                entryAt={entryAt}
                exitAt={exitAt}
                isCompared={comparisonIds.includes(facility.id)}
                canCompareMore={comparisonIds.length < 3}
                onToggleCompare={handleToggleCompare}
                onViewDetails={(f) => setDetailFacility(f)}
                onSelect={(f) => handleSelectFacility(f)}
              />
            ))}
          </section>
        )}

        {/* Manual Consultation Operators Section */}
        {manualFacilities.length > 0 && (
          <section className="manual-operators-section" aria-label="Operadores con tarifa bajo consulta">
            <div className="manual-section-header">
              <span className="pill-badge pill-slate">Cobertura de Mercado</span>
              <h2 className="manual-section-title">
                Operadores identificados sin tarifa digital pública automatizada
              </h2>
              <p className="manual-section-sub">
                Empresas que prestan servicio en el entorno de {airport ? airport.name : "este aeropuerto"} mediante contratación telefónica, flotas corporativas o presupuesto a medida. Por rigor y transparencia, en AeroValet no inventamos tarifas aproximadas.
              </p>
            </div>

            <div className="manual-grid">
              {manualFacilities.map((facility) => (
                <ParkingCard
                  key={facility.id}
                  facility={facility}
                  entryAt={entryAt}
                  exitAt={exitAt}
                  isCompared={comparisonIds.includes(facility.id)}
                  canCompareMore={comparisonIds.length < 3}
                  onToggleCompare={handleToggleCompare}
                  onViewDetails={(f) => setDetailFacility(f)}
                  onSelect={(f) => handleSelectFacility(f)}
                />
              ))}
            </div>
          </section>
        )}

        {/* FAQ Section */}
        <FaqSection airportName={airport?.name} />
      </div>

      {/* Floating Comparison Bar */}
      <ComparisonBar
        selectedFacilities={comparedFacilities}
        onOpenComparison={() => setIsComparisonOpen(true)}
        onRemoveFacility={handleToggleCompare}
        onClearAll={() => setComparisonIds([])}
      />

      {/* Comparison Modal */}
      {isComparisonOpen && (
        <ComparisonModal
          facilities={comparedFacilities}
          entryAt={entryAt}
          exitAt={exitAt}
          onClose={() => setIsComparisonOpen(false)}
          onRemoveFacility={handleToggleCompare}
          onSelectFacility={(f) => {
            setIsComparisonOpen(false);
            handleSelectFacility(f);
          }}
        />
      )}

      {/* Parking Detail Modal */}
      {detailFacility && (
        <ParkingDetailModal
          facility={detailFacility}
          entryAt={entryAt}
          exitAt={exitAt}
          onClose={() => setDetailFacility(null)}
          onProceed={(f, extras) => {
            setDetailFacility(null);
            handleSelectFacility(f, extras);
          }}
        />
      )}
    </div>
  );
}
