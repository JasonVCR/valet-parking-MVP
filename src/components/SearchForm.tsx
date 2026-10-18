"use client";

/**
 * SearchForm — airport parking search form.
 *
 * Accessibility:
 * - Uses native <select> and <input type="datetime-local"> for broad device support.
 * - All inputs have associated <label> elements (htmlFor).
 * - Error messages are linked via aria-describedby.
 * - Submit button disabled while form has validation errors.
 *
 * Constraints enforced:
 * - Entry must be ≥ 30 minutes from now (guard, server re-validates).
 * - Exit must be after entry.
 * - Minimum stay: 1 hour.
 * - Maximum stay: 30 days.
 */

import { useState, useId, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Airport } from "@/types/domain";
import { searchParamsSchema } from "@/lib/schemas/search";

interface SearchFormProps {
  airports: Airport[];
  /** When true, show a visible demo-mode notice */
  isDemoMode?: boolean;
}

/** Format a Date to the value expected by <input type="datetime-local"> */
function toDatetimeLocalValue(date: Date): string {
  // datetime-local requires "YYYY-MM-DDTHH:MM" (no seconds, no Z)
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Default entry: tomorrow at 10:00 */
function defaultEntryAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/** Default exit: entry + 7 days */
function defaultExitAt(entryValue: string): string {
  const d = new Date(entryValue);
  d.setDate(d.getDate() + 7);
  return toDatetimeLocalValue(d);
}

export function SearchForm({ airports, isDemoMode = false }: SearchFormProps) {
  const formId = useId();
  const router = useRouter();

  const [airportId, setAirportId] = useState(airports[0]?.id ?? "");
  const [entryAt, setEntryAt] = useState("");
  const [exitAt, setExitAt] = useState("");
  const [minEntryValue, setMinEntryValue] = useState("");
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
        entry_at: data.entry_at
          ? new Date(data.entry_at).toISOString()
          : "",
        exit_at: data.exit_at
          ? new Date(data.exit_at).toISOString()
          : "",
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
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form
      id={`${formId}-form`}
      onSubmit={handleSubmit}
      className="search-form"
      noValidate
      aria-label="Buscar aparcamiento en aeropuerto"
    >
      {isDemoMode && (
        <div className="demo-banner" role="status" aria-live="polite">
          <span className="demo-icon">🔬</span>
          <strong>Modo demostración</strong> — Sin credenciales de Supabase configuradas.
          Los resultados reales de instalaciones no están disponibles.
        </div>
      )}

      {/* Airport selector */}
      <div className="field-group">
        <label htmlFor={`${formId}-airport`} className="field-label">
          Aeropuerto
        </label>
        <select
          id={`${formId}-airport`}
          value={airportId}
          onChange={(e) => setAirportId(e.target.value)}
          className={`field-select ${errors.airport_id ? "field-error" : ""}`}
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
        {errors.airport_id && (
          <span id={`${formId}-airport-err`} className="error-msg" role="alert">
            {errors.airport_id}
          </span>
        )}
      </div>

      {/* Date/time grid */}
      <div className="date-grid">
        {/* Entry */}
        <div className="field-group">
          <label htmlFor={`${formId}-entry`} className="field-label">
            Entrada
          </label>
          <input
            id={`${formId}-entry`}
            type="datetime-local"
            value={entryAt}
            min={minEntryValue}
            onChange={(e) => {
              setEntryAt(e.target.value);
              // Auto-adjust exit if it's now before entry
              if (exitAt && e.target.value >= exitAt) {
                const newExit = new Date(e.target.value);
                newExit.setDate(newExit.getDate() + 1);
                setExitAt(toDatetimeLocalValue(newExit));
              }
            }}
            className={`field-input ${errors.entry_at ? "field-error" : ""}`}
            aria-describedby={errors.entry_at ? `${formId}-entry-err` : undefined}
            required
          />
          {errors.entry_at && (
            <span id={`${formId}-entry-err`} className="error-msg" role="alert">
              {errors.entry_at}
            </span>
          )}
        </div>

        {/* Exit */}
        <div className="field-group">
          <label htmlFor={`${formId}-exit`} className="field-label">
            Salida
          </label>
          <input
            id={`${formId}-exit`}
            type="datetime-local"
            value={exitAt}
            min={entryAt || minEntryValue}
            onChange={(e) => setExitAt(e.target.value)}
            className={`field-input ${errors.exit_at ? "field-error" : ""}`}
            aria-describedby={errors.exit_at ? `${formId}-exit-err` : undefined}
            required
          />
          {errors.exit_at && (
            <span id={`${formId}-exit-err`} className="error-msg" role="alert">
              {errors.exit_at}
            </span>
          )}
        </div>
      </div>

      <button
        type="submit"
        id="search-submit-btn"
        className="search-btn"
        disabled={submitting || airports.length === 0}
        aria-busy={submitting}
      >
        {submitting ? "Buscando…" : "Buscar aparcamiento"}
      </button>
    </form>
  );
}
