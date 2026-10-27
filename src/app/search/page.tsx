import { Suspense } from "react";
import Link from "next/link";
import { getActiveAirports } from "@/server/airports";
import { getFacilitiesWithServices } from "@/server/facilities";
import { Header } from "@/components/Header";
import { SearchResults } from "@/components/SearchResults";
import { searchParamsSchema } from "@/lib/schemas/search";
import { AlertCircle, RotateCcw } from "@/components/icons";

interface SearchPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function SearchResultsLoading() {
  return (
    <div className="search-page-wrapper">
      <Header isDemoMode={true} />
      <main className="results-container mt-8 text-center p-12">
        <div className="empty-results-box">
          <div className="spinner-icon">✈️</div>
          <h2>Buscando aparcamientos disponibles…</h2>
          <p>Consultando disponibilidad y servicios de los operadores autorizados en tiempo real…</p>
        </div>
      </main>
    </div>
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
      <div className="search-page-wrapper">
        <Header isDemoMode={true} />
        <main className="results-container py-10">
          <div className="alert-card alert-warning">
            <div className="alert-header">
              <AlertCircle size={20} />
              <h2>Criterios de búsqueda no válidos</h2>
            </div>
            <p>Los parámetros proporcionados no cumplen con las reglas de reserva del marketplace:</p>
            <ul className="error-list">
              {validationResult.error.issues.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
            <div className="mt-6">
              <Link href="/" className="btn-new-search">
                <RotateCcw size={14} />
                <span>Volver al formulario de búsqueda</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
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

  return (
    <div className="search-page-wrapper">
      <Header isDemoMode={facilitiesResult.mode === "demo"} />
      <SearchResults
        facilities={facilitiesResult.facilities}
        manualFacilities={facilitiesResult.manualFacilities ?? []}
        airport={currentAirport ?? null}
        entryAt={entry_at}
        exitAt={exit_at}
        isDemoMode={facilitiesResult.mode === "demo"}
        errorMessage={facilitiesResult.mode === "error" ? facilitiesResult.error : undefined}
      />
    </div>
  );
}

export default function SearchResultsPage({ searchParams }: SearchPageProps) {
  return (
    <Suspense fallback={<SearchResultsLoading />}>
      <SearchResultsContent searchParams={searchParams} />
    </Suspense>
  );
}

