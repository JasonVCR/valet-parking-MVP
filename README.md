# Valet Parking MVP — Starter

Base técnica inicial para un marketplace de reservas de aparcamiento en aeropuertos. El paquete define la primera migración de Supabase/PostgreSQL y el flujo de trabajo para desarrollar en Antigravity y prototipar interfaces en Google AI Studio.

> Estado: **fundación inicial, no lista para producción**. Antes de aceptar pagos reales hay que implementar y probar los endpoints de reserva, Stripe Connect, webhooks idempotentes, emails, límites de abuso, observabilidad y políticas operativas.

## Stack propuesto

- Next.js + TypeScript para el producto web.
- Supabase/PostgreSQL para persistencia, Auth y Row Level Security.
- Stripe Connect Express para onboarding y pagos de operadores.
- Vitest para pruebas unitarias y Playwright para pruebas de extremo a extremo.
- Vercel para web y Supabase para datos.
- GitHub como fuente oficial del código.

## Primer flujo del cliente

1. Buscar por aeropuerto y fechas/horas de entrada y salida.
2. Comparar aparcamientos y servicios disponibles.
3. Seleccionar servicio y vehículo.
4. Crear un `booking_hold` transaccional y temporal.
5. Iniciar Checkout de Stripe en el servidor.
6. Confirmar la reserva únicamente después de verificar el webhook de Stripe.
7. Enviar confirmación y permitir consultar la reserva.

## Base de datos

La migración `supabase/migrations/20261017000100_initial_schema.sql` crea el modelo inicial y activa RLS. El RPC `create_booking_hold` bloquea la fila de la instalación (`FOR UPDATE`) mientras comprueba la capacidad y crea el hold; de este modo, dos solicitudes concurrentes no pueden reservar la última plaza basándose en la misma comprobación obsoleta.

La función cuenta vehículos/estancias solapadas de reservas confirmadas/activas y holds no expirados. Cada reserva consume una unidad de capacidad. `operational_buffer` reserva un margen operativo configurable en la instalación.

### Reglas que no deben romperse

- Todos los intervalos se guardan como `timestamptz`; la zona horaria del aeropuerto vive en `airports.timezone`.
- Las cantidades monetarias se guardan como enteros en unidades menores (p. ej., céntimos), nunca como `float`.
- Los precios, moneda y unidades calculadas se congelan en `price_snapshot` al crear el hold.
- La interfaz jamás es autoridad para precio, disponibilidad, comisión o estado de pago.
- El webhook validado de Stripe es la fuente de verdad del pago; debe procesarse de forma idempotente.
- La confirmación del hold y la creación de la reserva deben realizarse en una misma transacción del servidor.
- Los cambios de capacidad deben pasar por funciones/servicios que bloqueen la misma fila de `facilities`.
- Las claves secretas deben permanecer en el servidor y en el gestor de secretos; nunca en variables `NEXT_PUBLIC_*`.

## Decisiones pendientes antes de producción

1. Política comercial de precios (por estancia, día u hora; redondeo; días naturales frente a bloques de 24 horas).
2. Comisión de plataforma y modelo de cargo de Stripe Connect (destination charges o separate charges and transfers).
3. Política de cancelación, reembolsos, no-shows y retrasos.
4. Duración real del hold: la migración usa 15 minutos como valor inicial ajustable.
5. Zona operativa, divisas admitidas, impuestos y requisitos legales por país.

## Arranque

1. Crear un repositorio GitHub nuevo llamado `valet-parking-mvp` (o el nombre definitivo acordado).
2. Copiar este paquete al repositorio.
3. Crear un proyecto Supabase de desarrollo, no de producción.
4. Aplicar la migración mediante Supabase CLI o el SQL Editor tras revisarla.
5. Abrir el repositorio en Antigravity y utilizar `docs/ANTIGRAVITY_START_PROMPT.md`.
6. Usar `docs/GOOGLE_AI_STUDIO_UI_PROMPT.md` para generar únicamente un prototipo de interfaz; revisar cada cambio antes de sincronizarlo con la rama principal.

## Licencias de repositorios de referencia

Este starter no incorpora código de los repositorios investigados; implementa un esquema propio. Antes de reutilizar código de cualquier repo de referencia, revisa su licencia, avisos de copyright y condiciones aplicables.
