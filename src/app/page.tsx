import { Suspense } from "react";
import { getActiveAirports } from "@/server/airports";
import { SearchForm } from "@/components/SearchForm";

export default async function HomePage() {
  const airportsResult = await getActiveAirports();

  return (
    <div className="home-wrapper">
      {/* Top navigation */}
      <header className="top-nav">
        <div className="nav-container">
          <div className="brand">
            <span className="brand-icon">✈️</span>
            <span className="brand-name">ValetParking MVP</span>
          </div>
          <span className="badge-env">Marketplace Aeropuertos</span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Aparcamiento seguro y servicio valet en los principales aeropuertos
          </h1>
          <p className="hero-subtitle">
            Compara operadores verificados, reserva tu plaza con confirmación en tiempo real y viaja sin preocupaciones.
          </p>

          <div className="search-card">
            <h2 className="search-title">Encuentra tu plaza</h2>
            <Suspense fallback={<div className="p-4 text-center">Cargando buscador…</div>}>
              <SearchForm
                airports={airportsResult.airports}
                isDemoMode={airportsResult.mode === "demo"}
              />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Value Propositions */}
      <section className="features-section" aria-label="Ventajas del servicio">
        <div className="features-container">
          <h2 className="features-title">Por qué reservar con nosotros</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🚘</div>
              <h3>Servicio Valet en Terminal</h3>
              <p>
                Entrega y recoge tu coche directamente frente a la terminal de salidas. Sin traslados ni esperas.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🛡️</div>
              <h3>Capacidad Garantizada</h3>
              <p>
                Bloqueo atómico de capacidad al iniciar el proceso. Nunca sobrevenderemos tu plaza.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">💳</div>
              <h3>Pago Seguro con Stripe</h3>
              <p>
                Confirmación bancaria transparente a través de Stripe Connect. Tu dinero está seguro en todo momento.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔄</div>
              <h3>Cancelación Flexible</h3>
              <p>
                Reembolso garantizado cancelando hasta 24 horas antes del inicio de tu reserva.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-container">
          <p>© 2026 Valet Parking Marketplace — MVP Verificable</p>
          <p className="footer-subtext">Next.js + TypeScript + Supabase + Stripe Connect</p>
        </div>
      </footer>
    </div>
  );
}
