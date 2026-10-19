"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Airport } from "@/types/domain";
import { searchParamsSchema } from "@/lib/schemas/search";
import {
  MapPin,
  Calendar,
  Clock,
  Search,
  Sparkles,
  Plane,
  ShieldCheck,
  Star,
} from "./icons";

interface HeroSearchProps {
  airports: Airport[];
  isDemoMode?: boolean;
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function defaultEntryAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

function defaultExitAt(entryValue: string): string {
  const d = new Date(entryValue);
  d.setDate(d.getDate() + 7);
  return toDatetimeLocalValue(d);
}

export function HeroSearch({ airports, isDemoMode = false }: HeroSearchProps) {
  const formId = useId();
  const router = useRouter();

  const [airportId, setAirportId] = useState(airports[0]?.id ?? "");
  const [entryAt, setEntryAt] = useState("");
  const [exitAt, setExitAt] = useState("");
  const [minEntryValue, setMinEntryValue] = useState("");
  const [serviceTypeFilter, setServiceTypeFilter] = useState<"all" | "valet" | "shuttle">("all");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const entry = defaultEntryAt();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntryAt(entry);
    setExitAt(defaultExitAt(entry));
    setMinEntryValue(
      toDatetimeLocalValue(new Date(Date.now() + 31 * 60 * 1_000))
    );
  }, []);

  const validate = useCallback(
    (data: { airport_id: string; entry_at: string; exit_at: string }) => {
      const result = searchParamsSchema.safeParse({
        airport_id: data.airport_id,
        entry_at: data.entry_at ? new Date(data.entry_at).toISOString() : "",
        exit_at: data.exit_at ? new Date(data.exit_at).toISOString() : "",
      });

      if (result.success) {
        setErrors({});
        return true;
      }

      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        if (!errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      return false;
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { airport_id: airportId, entry_at: entryAt, exit_at: exitAt };
    if (!validate(data)) return;

    setSubmitting(true);
    const params = new URLSearchParams({
      airport_id: airportId,
      entry_at: new Date(entryAt).toISOString(),
      exit_at: new Date(exitAt).toISOString(),
    });
    if (serviceTypeFilter !== "all") {
      params.set("modality", serviceTypeFilter);
    }
    router.push(`/search?${params.toString()}`);
  };

  const selectedAirportObj = airports.find((a) => a.id === airportId);

  return (
    <section className="hero-search-wrapper" aria-label="Búsqueda principal de parking">
      <div className="hero-container">
        {/* Top Badges & Headline */}
        <div className="hero-header-grid">
          <div className="hero-text-col">
            <div className="hero-pills-row">
              <span className="pill-badge pill-blue">
                <Sparkles size={13} />
                Marketplace de Parking en Aeropuertos
              </span>
              <span className="pill-badge pill-emerald">
                <ShieldCheck size={13} />
                Gestión de Capacidad en Tiempo Real
              </span>
            </div>

            <h1 className="hero-main-title">
              Aparcamiento seguro y servicio valet en los principales aeropuertos
            </h1>
            <p className="hero-main-desc">
              Compara opciones de aparcamiento y servicio valet en aeropuertos con tarifas calculadas de forma exacta en el servidor.
            </p>

            <div className="hero-trust-metrics">
              <div className="trust-item">
                <ShieldCheck size={14} />
                <span><strong>Operadores registrados</strong> y verificados</span>
              </div>
              <span className="trust-divider">•</span>
              <div className="trust-item">
                <Plane size={14} />
                <span>Modalidad Valet y Lanzadera</span>
              </div>
              <span className="trust-divider">•</span>
              <div className="trust-item">
                <Sparkles size={14} />
                <span>Condiciones de cancelación claras</span>
              </div>
            </div>
          </div>

          {/* Hero Visual Teaser */}
          <div className="hero-visual-card">
            <div className="visual-image-box">
              <Image
                src="/images/valet_terminal_dropoff_1792282144660.jpg"
                alt="Servicio valet en terminal de salidas"
                fill
                sizes="(max-width: 768px) 100vw, 420px"
                className="visual-img"
                priority
              />
              <div className="visual-overlay">
                <span className="visual-tag">Servicio Valet en Terminal</span>
                <p className="visual-caption">
                  Llegas a Salidas, entregas la llave en mano y vas directo a tu puerta de embarque.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Search Engine Form Card */}
        <div className="search-form-card">
          <form
            id={`${formId}-form`}
            onSubmit={handleSubmit}
            noValidate
            aria-label="Buscar aparcamiento en aeropuerto"
          >
            {/* Filter Modality Tabs */}
            <div className="modality-switch-row">
              <div className="modality-tabs" role="radiogroup" aria-label="Modalidad de servicio">
                <button
                  type="button"
                  onClick={() => setServiceTypeFilter("all")}
                  className={`modality-btn ${serviceTypeFilter === "all" ? "active" : ""}`}
                  role="radio"
                  aria-checked={serviceTypeFilter === "all"}
                >
                  Todas las modalidades
                </button>
                <button
                  type="button"
                  onClick={() => setServiceTypeFilter("valet")}
                  className={`modality-btn ${serviceTypeFilter === "valet" ? "active" : ""}`}
                  role="radio"
                  aria-checked={serviceTypeFilter === "valet"}
                >
                  Valet en Terminal
                </button>
                <button
                  type="button"
                  onClick={() => setServiceTypeFilter("shuttle")}
                  className={`modality-btn ${serviceTypeFilter === "shuttle" ? "active" : ""}`}
                  role="radio"
                  aria-checked={serviceTypeFilter === "shuttle"}
                >
                  Lanzadera / Shuttle
                </button>
              </div>

              {selectedAirportObj && (
                <div className="airport-tz-note">
                  Zona horaria operativa: <strong>{selectedAirportObj.timezone}</strong>
                </div>
              )}
            </div>

            {/* Inputs Grid */}
            <div className="search-inputs-grid">
              {/* Airport Selector */}
              <div className="input-field-col airport-col">
                <label htmlFor={`${formId}-airport`} className="input-label">
                  Aeropuerto
                </label>
                <div className="input-wrapper">
                  <MapPin className="input-icon" size={16} />
                  <select
                    id={`${formId}-airport`}
                    value={airportId}
                    onChange={(e) => setAirportId(e.target.value)}
                    className={`form-select ${errors.airport_id ? "input-has-error" : ""}`}
                    aria-describedby={errors.airport_id ? `${formId}-airport-err` : undefined}
                    required
                    disabled={airports.length === 0}
                  >
                    {airports.length === 0 ? (
                      <option value="">Sin aeropuertos disponibles</option>
                    ) : (
                      airports.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.iata_code}) — {a.city}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {errors.airport_id && (
                  <span id={`${formId}-airport-err`} className="error-text" role="alert">
                    {errors.airport_id}
                  </span>
                )}
              </div>

              {/* Entry Date & Time */}
              <div className="input-field-col datetime-col">
                <label htmlFor={`${formId}-entry`} className="input-label">
                  Entrega / Entrada
                </label>
                <div className="input-wrapper">
                  <Calendar className="input-icon" size={16} />
                  <input
                    id={`${formId}-entry`}
                    type="datetime-local"
                    value={entryAt}
                    min={minEntryValue}
                    onChange={(e) => {
                      setEntryAt(e.target.value);
                      if (exitAt && e.target.value >= exitAt) {
                        const newExit = new Date(e.target.value);
                        newExit.setDate(newExit.getDate() + 1);
                        setExitAt(toDatetimeLocalValue(newExit));
                      }
                    }}
                    className={`form-input ${errors.entry_at ? "input-has-error" : ""}`}
                    aria-describedby={errors.entry_at ? `${formId}-entry-err` : undefined}
                    required
                  />
                </div>
                {errors.entry_at && (
                  <span id={`${formId}-entry-err`} className="error-text" role="alert">
                    {errors.entry_at}
                  </span>
                )}
              </div>

              {/* Exit Date & Time */}
              <div className="input-field-col datetime-col">
                <label htmlFor={`${formId}-exit`} className="input-label">
                  Recogida / Salida
                </label>
                <div className="input-wrapper">
                  <Clock className="input-icon" size={16} />
                  <input
                    id={`${formId}-exit`}
                    type="datetime-local"
                    value={exitAt}
                    min={entryAt || minEntryValue}
                    onChange={(e) => setExitAt(e.target.value)}
                    className={`form-input ${errors.exit_at ? "input-has-error" : ""}`}
                    aria-describedby={errors.exit_at ? `${formId}-exit-err` : undefined}
                    required
                  />
                </div>
                {errors.exit_at && (
                  <span id={`${formId}-exit-err`} className="error-text" role="alert">
                    {errors.exit_at}
                  </span>
                )}
              </div>

              {/* Search Submit CTA */}
              <div className="input-field-col cta-col">
                <button
                  type="submit"
                  id="hero-search-submit-btn"
                  className="search-submit-btn"
                  disabled={submitting || airports.length === 0}
                  aria-busy={submitting}
                >
                  <Search size={16} />
                  <span>{submitting ? "Buscando…" : "Buscar aparcamiento"}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
