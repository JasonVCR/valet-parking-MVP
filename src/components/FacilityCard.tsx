import type { FacilityWithServices } from "@/types/domain";
import {
  computeBillableUnits,
  computeTotalAmount,
  formatMoney,
} from "@/lib/pricing";

interface FacilityCardProps {
  facility: FacilityWithServices;
  entryAt: string;
  exitAt: string;
}

export function FacilityCard({
  facility,
  entryAt,
  exitAt,
}: FacilityCardProps) {
  return (
    <article className="facility-card" aria-labelledby={`facility-title-${facility.id}`}>
      <div className="facility-header">
        <div>
          <span className="facility-operator">{facility.operator.name}</span>
          <h3 id={`facility-title-${facility.id}`} className="facility-name">
            {facility.name}
          </h3>
          <p className="facility-address">
            📍 {facility.address}
          </p>
        </div>
        <span className="badge-verified">Verificado</span>
      </div>

      <div className="facility-services">
        <h4 className="services-heading">Servicios disponibles</h4>
        <div className="services-list">
          {facility.services.map((service) => {
            let units = 1;
            let totalAmount = service.price_amount;
            let calculationError = false;

            try {
              units = computeBillableUnits(service.pricing_unit, entryAt, exitAt);
              totalAmount = computeTotalAmount(service.price_amount, units);
            } catch {
              calculationError = true;
            }

            const unitLabels: Record<string, string> = {
              per_stay: "estancia",
              per_day: "día",
              per_hour: "hora",
            };

            return (
              <div key={service.id} className="service-item">
                <div className="service-details">
                  <div className="service-title-row">
                    <span className="service-name">{service.name}</span>
                    <span className="service-unit-tag">
                      {unitLabels[service.pricing_unit] ?? service.pricing_unit}
                    </span>
                  </div>
                  {service.description && (
                    <p className="service-desc">{service.description}</p>
                  )}
                  <div className="service-meta">
                    <span className="cancel-policy">✓ Cancelación gratuita hasta 24h antes</span>
                  </div>
                </div>

                <div className="service-pricing-action">
                  <div className="pricing-box">
                    {!calculationError ? (
                      <>
                        <span className="price-total">
                          {formatMoney(totalAmount, service.currency)}
                        </span>
                        <span className="price-subtext">
                          {units} {units === 1 ? "unidad" : "unidades"} ({formatMoney(service.price_amount, service.currency)}/{unitLabels[service.pricing_unit]})
                        </span>
                      </>
                    ) : (
                      <span className="price-total">
                        {formatMoney(service.price_amount, service.currency)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="select-service-btn"
                    data-facility-id={facility.id}
                    data-service-id={service.id}
                    onClick={() => {
                      alert("Paso de Checkout con Stripe disponible en el próximo incremento");
                    }}
                  >
                    Seleccionar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
