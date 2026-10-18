# Prompt para Google AI Studio — prototipo de interfaz

Crea un **prototipo visual responsive** para un marketplace de valet parking y aparcamiento cerca de aeropuertos. El nombre del producto debe ser temporal y editable. La interfaz será en español, con una estética moderna, clara y de confianza, centrada en completar una reserva.

## Pantallas

1. Landing / búsqueda con aeropuerto, entrada, salida y búsqueda.
2. Resultados en tarjetas comparables: nombre del parking, modalidad del servicio, distancia como dato opcional, servicios incluidos, precio total, política de cancelación y CTA para seleccionar.
3. Detalle de instalación y servicio.
4. Formulario de cliente/vehículo y resumen de reserva.
5. Pantallas de estado: procesando, reserva confirmada, pago fallido y sin disponibilidad.
6. Panel de operador sencillo: próximas reservas, capacidad, precios y estado de conexión de Stripe.

## Reglas del prototipo

- Prioriza móvil, accesibilidad, contraste y formularios etiquetados.
- No inventes precios, reseñas ni disponibilidad real. Usa datos ficticios claramente marcados como demo.
- El total debe mostrarse como resumen de ejemplo, no como cálculo válido para producción.
- No implementes una integración real de Stripe ni solicites claves secretas.
- No crees una segunda arquitectura/backend ni alteres el esquema PostgreSQL de `docs/ARCHITECTURE.md`.
- Usa componentes reutilizables y estados vacíos, de carga y error.
- Mantén separadas las pantallas del cliente y del operador.

El resultado es un prototipo de UX. Antes de integrar cualquier código en el repositorio principal, revisaremos los cambios y los conectaremos a los contratos reales del backend.
