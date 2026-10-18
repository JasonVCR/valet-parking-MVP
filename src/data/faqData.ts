export interface FaqItem {
  id: string;
  category: "valet" | "booking" | "security" | "flights";
  categoryLabel: string;
  question: string;
  answer: string;
  highlight?: string;
  popular?: boolean;
}

export const FAQ_CATEGORIES = [
  { id: "all", label: "Todas las dudas" },
  { id: "valet", label: "Servicio Valet" },
  { id: "booking", label: "Reserva y Pagos" },
  { id: "security", label: "Custodia y Seguridad" },
  { id: "flights", label: "Vuelos y Retrasos" },
] as const;

export type FaqCategoryId = (typeof FAQ_CATEGORIES)[number]["id"];

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "faq-1",
    category: "valet",
    categoryLabel: "Servicio Valet",
    question: "¿Cómo funciona exactamente el servicio de Valet Parking en la terminal?",
    answer:
      "Conduces tu propio vehículo directamente hasta el carril de salidas de la terminal correspondiente a tu vuelo. Un chófer profesional uniformado y debidamente acreditado te esperará en el punto acordado. Juntos realizaréis una rápida inspección fotográfica del vehículo y kilometraje antes de firmar el acta digital de entrega. El chófer traslada tu coche a las instalaciones privadas y vigiladas. A tu regreso, tras aterrizar y recoger tu equipaje, nos llamas y te devolverán tu vehículo en la misma puerta de la terminal de llegadas sin esperas ni traslados.",
    highlight: "Entrega directa en salidas y recogida en llegadas (0 min de espera).",
    popular: true,
  },
  {
    id: "faq-2",
    category: "valet",
    categoryLabel: "Servicio Valet",
    question: "¿Qué diferencia hay entre Valet Parking y Servicio Lanzadera (Shuttle)?",
    answer:
      "• Valet Parking: Máximo confort. Entregas y recoges el vehículo en la puerta de la terminal con chófer. Es la opción ideal si viajas en familia, con equipaje pesado o por negocios.\n• Servicio Lanzadera (Shuttle): Conduces hasta el parking vigilado cercano al aeropuerto (a 3-8 minutos) y un minibús privado y gratuito te traslada a ti y a tus acompañantes hasta la terminal, recogiéndote a la vuelta.",
    highlight: "Elige según si priorizas comodidad máxima (Valet) o precio más económico (Lanzadera).",
    popular: true,
  },
  {
    id: "faq-3",
    category: "security",
    categoryLabel: "Custodia y Seguridad",
    question: "¿Dónde queda guardado mi vehículo y qué medidas de seguridad existen?",
    answer:
      "Los parkings adheridos a la plataforma disponen de recintos privados cerrados perimetralmente, dotados de barrera de control de accesos, vigilancia física y circuito cerrado de televisión (CCTV) 24/7. Además, cada reserva incluye un seguro de responsabilidad civil que cubre cualquier incidencia durante el traslado y la estancia bajo custodia del operador.",
    highlight: "Recintos cerrados y vigilancia continua durante toda tu estancia.",
  },
  {
    id: "faq-4",
    category: "flights",
    categoryLabel: "Vuelos y Retrasos",
    question: "¿Qué ocurre si mi vuelo de vuelta se retrasa o aterriza de madrugada?",
    answer:
      "Los operadores monitorean el número de vuelo indicado en la reserva. En caso de retraso, el equipo ajusta el horario de entrega para tener tu vehículo listo en el momento exacto en que salgas de la terminal. Si el retraso supera las 2 horas respecto a la hora prevista, se aplicará la tarifa horaria estipulada por el operador sin penalizaciones abusivas.",
    highlight: "Seguimiento de vuelo en tiempo real y asistencia ante imprevistos.",
    popular: true,
  },
  {
    id: "faq-5",
    category: "booking",
    categoryLabel: "Reserva y Pagos",
    question: "¿Cómo se confirma la reserva y cuándo se realiza el cobro?",
    answer:
      "Durante la búsqueda tu plaza se reserva temporalmente mediante un bloqueo (hold) atómico en el servidor para evitar sobreventa. El cobro final se procesa de forma segura a través de Stripe Connect una vez confirmada la reserva. Recibirás tu justificante con localizador único inmediatamente por correo electrónico.",
    highlight: "Bloqueo atómico contra sobreventa y pago seguro vía Stripe Connect.",
  },
  {
    id: "faq-6",
    category: "booking",
    categoryLabel: "Reserva y Pagos",
    question: "¿Puedo cancelar o modificar mi reserva? ¿Tiene algún coste?",
    answer:
      "Todas las reservas estándar en AeroValet ofrecen cancelación 100% gratuita hasta 24 horas antes de la hora de entrega fijada en la reserva. Si cancelas antes de dicho plazo, el reembolso del importe íntegro se procesa de manera automática al mismo método de pago utilizado.",
    highlight: "Cancelación flexible gratuita hasta 24 horas antes de la entrada.",
  },
];
