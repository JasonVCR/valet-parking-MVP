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
              <h2 className="features-title">Por qué reservar en AeroValet</h2>
              <p className="features-sub">
                Garantizamos una experiencia de aparcamiento sin sorpresas, con contratos auditados y custodia profesional.
              </p>
            </div>

            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon-wrapper icon-blue">
                  <CarFront size={24} />
                </div>
                <h3>Servicio Valet VIP en Terminal</h3>
                <p>
                  Entrega y recoge tu coche directamente frente a las puertas de Salidas y Llegadas. Sin traslados, sin esperas ni pérdidas de tiempo.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-emerald">
                  <ShieldCheck size={24} />
                </div>
                <h3>Bloqueo Atómico de Capacidad</h3>
                <p>
                  Tu plaza queda asegurada en la base de datos al iniciar el proceso con hold transaccional. Cero riesgo de sobreventa.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-indigo">
                  <CreditCard size={24} />
                </div>
                <h3>Pago Transparente vía Stripe</h3>
                <p>
                  Transacciones directas con proveedores oficiales mediante Stripe Connect. Precios calculados en servidor en céntimos enteros.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-wrapper icon-amber">
                  <Sparkles size={24} />
                </div>
                <h3>Cancelación Flexible Gratuita</h3>
                <p>
                  Reembolso del 100% garantizado cancelando hasta 24 horas antes del inicio de tu estancia sin justificaciones ni cargos ocultos.
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
                Marketplace verificable de aparcamiento en aeropuertos · Next.js + TypeScript + Supabase + Stripe Connect
              </p>
            </div>
            <div className="footer-pills">
              <span className="pill-badge pill-slate">MVP Verificable</span>
              <span className="pill-badge pill-slate">RLS & Hold Atómico</span>
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

