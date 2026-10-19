import { Suspense } from "react";
import { getActiveAirports } from "@/server/airports";
import { Header } from "@/components/Header";
import { HeroSearch } from "@/components/HeroSearch";
import { FaqSection } from "@/components/FaqSection";
import { ShieldCheck, CarFront, CreditCard, Sparkles } from "@/components/icons";

export default async function HomePage() {
  const airportsResult = await getActiveAirports();

  return (
    <div className="home-wrapper">
      <Header isDemoMode={airportsResult.mode === "demo"} />

      <main id="main-content">
        {/* Hero & Search Engine */}
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando buscador de aeropuertos…</div>}>
          <HeroSearch
            airports={airportsResult.airports}
            isDemoMode={airportsResult.mode === "demo"}
          />
        </Suspense>

        {/* Value Propositions / Trust Grid */}
        <section className="features-section" aria-label="Ventajas y garantías del marketplace">
          <div className="features-container">
            <div className="features-header">
              <span className="pill-badge pill-blue">
                <Sparkles size={13} />
                Estándar de Confianza
              </span>
              <h2 className="features-title">Por qué buscar en AeroValet</h2>
              <p className="features-sub">
                Compara opciones de aparcamiento y valet en aeropuertos con transparencia de precios y operadores registrados.
              </p>
            </div>

            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon-wrapper icon-blue">
                  <CarFront size={24} />
                </div>
                <h3>Servicio Valet y Lanzadera</h3>
                <p>
                  Elige entre entrega directa en la terminal de salidas o aparcamiento en instalaciones cercanas con transporte lanzadera.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-emerald">
                  <ShieldCheck size={24} />
                </div>
                <h3>Control de Capacidad en Servidor</h3>
                <p>
                  Comprobación de aforo en la base de datos con asignación temporal durante el proceso de reserva.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-indigo">
                  <CreditCard size={24} />
                </div>
                <h3>Cálculo de Precios en Servidor</h3>
                <p>
                  Tarifas calculadas de forma exacta en céntimos enteros en el servidor para evitar discrepancias.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-amber">
                  <Sparkles size={24} />
                </div>
                <h3>Condiciones Claras de Cancelación</h3>
                <p>
                  Información transparente sobre las políticas de cancelación y reembolso según la tarifa del operador contratado.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <div className="home-faq-wrap">
          <FaqSection />
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-container">
          <div className="footer-top-row">
            <div>
              <p className="footer-brand">AeroValet & Parking Hub</p>
              <p className="footer-subtext">
                Marketplace verificable de aparcamiento en aeropuertos · Next.js + TypeScript + Supabase
              </p>
            </div>
            <div className="footer-pills">
              <span className="pill-badge pill-slate">MVP Verificable</span>
              <span className="pill-badge pill-slate">RLS & Servidor Seguro</span>
            </div>
          </div>
          <div className="footer-bottom-row">
            <p>© 2026 AeroValet Marketplace. Todos los derechos reservados.</p>
            <p className="footer-disclaimer">
              Precios y disponibilidad gestionados por operadores autorizados independientes.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

