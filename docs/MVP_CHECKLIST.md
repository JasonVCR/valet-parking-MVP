# MVP — criterios de aceptación iniciales

## Hito 0 — Base del proyecto
- [ ] Repositorio GitHub nuevo y exclusivo.
- [ ] Aplicación Next.js con TypeScript, lint, typecheck y pruebas ejecutables.
- [ ] Supabase de desarrollo separado de staging/producción.
- [ ] Migración revisada y aplicada al proyecto de desarrollo.

## Hito 1 — Catálogo y búsqueda
- [ ] Cliente puede consultar aeropuertos activos.
- [ ] Entrada anterior a salida; zona horaria visible/resuelta según aeropuerto.
- [ ] Solo aparecen instalaciones/servicios activos.
- [ ] Cada resultado muestra la política de precio y cancelación que realmente aplique.
- [ ] Sin disponibilidad no se presenta como error inesperado.

## Hito 2 — Hold y capacidad
- [ ] Se rechaza entrada en el pasado y cualquier intervalo inválido.
- [ ] Cada reserva/hold ocupa una plaza durante su intervalo.
- [ ] Los holds expirados no bloquean capacidad.
- [ ] La creación de holds es atómica y testea carreras concurrentes.
- [ ] Los intentos directos del cliente a tablas protegidas se rechazan por RLS.

## Hito 3 — Pagos
- [ ] Operador completa onboarding de Stripe Connect.
- [ ] El servidor crea Checkout a partir de un hold válido y de un precio calculado en servidor.
- [ ] Webhook valida la firma de Stripe.
- [ ] `event_id` evita procesar dos veces el mismo evento.
- [ ] Solo el webhook confirmado consume el hold y crea la reserva.
- [ ] Fallo/caducidad libera el hold; reembolso queda registrado.

## Hito 4 — Operación y salida a staging
- [ ] Emails de confirmación y cancelación.
- [ ] Logs sin datos de tarjeta ni secretos.
- [ ] Playwright cubre búsqueda, hold, pago simulado y confirmación.
- [ ] Pruebas de aislamiento entre clientes y operadores.
- [ ] Variables de entorno y políticas de despliegue revisadas.
