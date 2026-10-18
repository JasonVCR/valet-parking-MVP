import { Suspense } from "react";
import Link from "next/link";
import { getActiveAirports } from "@/server/airports";
import { getFacilitiesWithServices } from "@/server/facilities";
import { FacilityCard } from "@/components/FacilityCard";
import { searchParamsSchema } from "@/lib/schemas/search";

interface SearchPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function SearchResultsLoading() {
  return (
    <main className="search-results-container">
      <header className="page-header">
        <Link href="/" className="back-link">
          ← Volver a la búsqueda
        </Link>
        <h1 className="page-title">Buscando aparcamientos disponibles…</h1>
      </header>
      <div className="empty-state-card">
        <p>Consultando disponibilidad y servicios de los operadores en tiempo real…</p>
      </div>
    </main>
  );
}

async function SearchResultsContent({ searchParams }: SearchPageProps) {
  const resolvedParams = await searchParams;

  const rawAirportId = Array.isArray(resolvedParams.airport_id)
    ? resolvedParams.airport_id[0]
    : resolvedParams.airport_id;
  const rawEntryAt = Array.isArray(resolvedParams.entry_at)
    ? resolvedParams.entry_at[0]
    : resolvedParams.entry_at;
  const rawExitAt = Array.isArray(resolvedParams.exit_at)
    ? resolvedParams.exit_at[0]
    : resolvedParams.exit_at;

  const validationResult = searchParamsSchema.safeParse({
    airport_id: rawAirportId,
    entry_at: rawEntryAt,
    exit_at: rawExitAt,
  });

  if (!validationResult.success) {
    return (
      <main className="search-results-container">
        <header className="page-header">
          <Link href="/" className="back-link">
            ← Volver a la búsqueda
          </Link>
          <h1 className="page-title">Criterios de búsqueda no válidos</h1>
        </header>
        <div className="alert-card alert-warning">
          <p>
            Los parámetros proporcionados no cumplen con las reglas de reserva:
          </p>
          <ul className="error-list">
            {validationResult.error.issues.map((issue, idx) => (
              <li key={idx}>{issue.message}</li>
            ))}
          </ul>
          <Link href="/" className="btn-primary mt-4">
            Nueva búsqueda
          </Link>
        </div>
      </main>
    );
  }

  const { airport_id, entry_at, exit_at } = validationResult.data;

  // Retrieve airports to display name
  const airportsResult = await getActiveAirports();
  const currentAirport = airportsResult.airports.find(
    (a) => a.id === airport_id
  );

  // Retrieve facilities
  const facilitiesResult = await getFacilitiesWithServices(
    airport_id,
    entry_at,
    exit_at
  );

  const entryDate = new Date(entry_at);
  const exitDate = new Date(exit_at);
  const diffHours = Math.round(
    (exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60)
  );
  const diffDays = Math.ceil(diffHours / 24);

  return (
    <main className="search-results-container">
      <header className="page-header">
        <Link href="/" className="back-link">
          ← Modificar búsqueda
        </Link>
        <h1 className="page-title">
          Aparcamientos en {currentAirport ? currentAirport.name : "Aeropuerto"}
        </h1>
        <div className="search-summary-bar">
          <div className="summary-item">
            <span className="summary-label">Aeropuerto</span>
            <span className="summary-value">
              {currentAirport
                ? `${currentAirport.iata_code} · ${currentAirport.city}`
                : "No especificado"}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Entrada</span>
            <span className="summary-value">
              {entryDate.toLocaleString("es-ES", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Salida</span>
            <span className="summary-value">
              {exitDate.toLocaleString("es-ES", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Duración</span>
            <span className="summary-value">
              {diffDays} {diffDays === 1 ? "día" : "días"} ({diffHours}h)
            </span>
          </div>
        </div>
      </header>

      {facilitiesResult.mode === "demo" && (
        <div className="demo-banner mb-6" role="status">
          <span className="demo-icon">🔬</span>
          <div>
            <strong>Modo demostración activo:</strong> Supabase no está configurado
            en el entorno local. Por seguridad y transparencia, nunca mostramos
            disponibilidad falsa como real.
          </div>
        </div>
      )}

      {facilitiesResult.mode === "error" && (
        <div className="alert-card alert-error mb-6">
          <h3>Error consultando instalaciones</h3>
          <p>{facilitiesResult.error}</p>
        </div>
      )}

      {facilitiesResult.facilities.length === 0 ? (
        <div className="empty-state-card">
          <div className="empty-icon">🚗</div>
          <h2>No hay aparcamientos disponibles</h2>
          <p>
            No encontramos parkings activos para este aeropuerto en las fechas
            seleccionadas. Por favor, prueba con otro aeropuerto o intervalo de
            tiempo.
          </p>
          <Link href="/" className="btn-secondary mt-4">
            Cambiar fechas o aeropuerto
          </Link>
        </div>
      ) : (
        <section className="results-grid" aria-label="Resultados de aparcamientos">
          {facilitiesResult.facilities.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              entryAt={entry_at}
              exitAt={exit_at}
            />
          ))}
        </section>
      )}
    </main>
  );
}

export default function SearchResultsPage({ searchParams }: SearchPageProps) {
  return (
    <Suspense fallback={<SearchResultsLoading />}>
      <SearchResultsContent searchParams={searchParams} />
    </Suspense>
  );
}
