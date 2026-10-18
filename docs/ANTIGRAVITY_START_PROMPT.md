# Prompt inicial para Antigravity

Actúa como tech lead y desarrollador full-stack del repositorio **Valet Parking MVP**. Este repositorio corresponde exclusivamente a un marketplace de reserva de aparcamiento en aeropuertos. No mezcles código ni decisiones con otros proyectos.

## Objetivo

Implementar un MVP seguro y verificable con Next.js + TypeScript, Supabase/PostgreSQL y Stripe Connect Express. Lee primero `README.md`, `docs/ARCHITECTURE.md` y la migración existente en `supabase/migrations/`. La migración es el contrato de datos inicial: si detectas un defecto, explícalo y propón una migración incremental; no reescribas ni elimines migraciones aplicadas.

## Orden de trabajo

1. Inspecciona el repositorio y plantea un plan corto con archivos a crear/modificar.
2. Crea el esqueleto Next.js con TypeScript, linting y pruebas. No agregues microservicios.
3. Implementa primero una página de búsqueda accesible y adaptable a móvil: aeropuerto, fecha/hora de entrada, fecha/hora de salida, botón de búsqueda y validación de fechas.
4. Define tipos de dominio y esquemas Zod a partir del modelo de base de datos.
5. Implementa la capa server-side para consultar aeropuertos, instalaciones y servicios activos. Si faltan credenciales, muestra un estado vacío explícito o un modo demo claramente etiquetado; nunca presentes disponibilidad simulada como real.
6. Añade pruebas unitarias para validación de intervalos, redondeo de tarifas y reglas de capacidad. Añade pruebas E2E del flujo de búsqueda.
7. Deja Stripe Connect para la siguiente tarea después de revisar el modelo y el flujo de búsqueda.

## Restricciones no negociables

- No confirmes pagos desde el frontend ni desde el redirect de Checkout.
- El webhook firmado de Stripe será la autoridad del estado de pago.
- No calcules precio final ni disponibilidad usando valores enviados por el navegador como autoridad.
- No uses `float` para dinero; usa enteros en unidades menores.
- No expongas service-role keys, Stripe secret keys ni otras credenciales en el cliente.
- No permitas que el cliente inserte directamente reservas o holds saltándose el RPC transaccional.
- Respeta RLS; añade tests para acceso entre usuarios y operadores.
- No copies código de repositorios de referencia con licencia no verificada.
- Mantén los cambios pequeños; ejecuta lint, typecheck y tests, e informa resultados reales. Si un comando no se pudo ejecutar, decláralo.

Antes de modificar archivos, presenta el plan. Después implementa el primer incremento completo, ejecuta las verificaciones disponibles y resume archivos cambiados, decisiones y pendientes.
