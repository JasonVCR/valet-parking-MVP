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
      "Conduces tu vehículo hasta el punto acordado en salidas de la terminal correspondiente a tu vuelo. El personal del operador te esperará para realizar la comprobación del estado del coche antes de la entrega. El conductor traslada tu vehículo a las instalaciones de aparcamiento del operador. A tu regreso, tras aterrizar y recoger tu equipaje, coordinas la devolución de tu coche en la terminal acordada.",
    highlight: "Entrega y recogida en terminal coordinada directamente con el operador.",
    popular: true,
  },
  {
    id: "faq-2",
    category: "valet",
    categoryLabel: "Servicio Valet",
    question: "¿Qué diferencia hay entre Valet Parking y Servicio Lanzadera (Shuttle)?",
    answer:
      "• Valet Parking: Entregas y recoges el vehículo en la propia terminal con el conductor del operador. Es una opción pensada para mayor comodidad y rapidez en salidas y llegadas.\n• Servicio Lanzadera (Shuttle): Conduces hasta el parking ubicado en las inmediaciones del aeropuerto y un vehículo de cortesía del operador traslada a los pasajeros hasta la terminal.",
    highlight: "Compara entre servicio valet directo en terminal y aparcamiento con transporte lanzadera.",
    popular: true,
  },
  {
    id: "faq-3",
    category: "security",
    categoryLabel: "Custodia y Seguridad",
    question: "¿Dónde queda guardado mi vehículo y qué medidas de seguridad existen?",
    answer:
      "Los parkings adheridos a la plataforma disponen de recintos cerrados perimetralmente con control de accesos, vigilancia y circuito de cámaras (CCTV). Cada operador cuenta con sus pólizas y coberturas de seguro aplicables durante la estancia del vehículo en sus instalaciones.",
    highlight: "Instalaciones con control de accesos y vigilancia según las especificaciones del operador.",
  },
  {
    id: "faq-4",
    category: "flights",
    categoryLabel: "Vuelos y Retrasos",
    question: "¿Qué ocurre si mi vuelo de vuelta se retrasa o aterriza en horario imprevisto?",
    answer:
      "Se recomienda indicar el número de vuelo en la reserva para facilitar el seguimiento por parte del operador. En caso de retraso significativo, se aplican las tarifas horarias o suplementos estipulados en las condiciones particulares del operador contratado.",
    highlight: "Seguimiento operativo y asistencia conforme a las condiciones de cada operador.",
    popular: true,
  },
  {
    id: "faq-5",
    category: "booking",
    categoryLabel: "Reserva y Pagos",
    question: "¿Cómo se confirma la reserva y cuándo se realiza el cobro?",
    answer:
      "Durante la búsqueda tu plaza se verifica en tiempo real en la base de datos con asignación temporal para evitar sobreventa. Los precios se calculan de manera determinista en el servidor en céntimos enteros. La pasarela de pago seguro procesa la transacción de acuerdo con la tarifa y modalidad seleccionada.",
    highlight: "Verificación de capacidad en tiempo real y precios calculados en el servidor.",
  },
  {
    id: "faq-6",
    category: "booking",
    categoryLabel: "Reserva y Pagos",
    question: "¿Puedo cancelar o modificar mi reserva? ¿Tiene algún coste?",
    answer:
      "Las condiciones de modificación y cancelación están sujetas a la tarifa y política comercial de cada operador de aparcamiento. Podrás revisar el detalle de la política de cancelación aplicable antes de completar la reserva.",
    highlight: "Condiciones de cancelación y reembolso según la tarifa y operador seleccionado.",
  },
];
