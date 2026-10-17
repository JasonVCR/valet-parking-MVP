# Arquitectura inicial

## Límites de módulos

- `airports`: catálogo y zonas horarias.
- `operators`: proveedores de aparcamiento que se adhieren al marketplace.
- `facilities`: instalaciones, capacidad y margen operativo.
- `services`: modalidades y tarifas de cada instalación.
- `availability`: reglas semanales, cierres excepcionales y comprobación de intervalos.
- `customers` / `vehicles`: identidad de cliente y vehículo.
- `booking-holds`: reserva temporal de capacidad durante Checkout.
- `bookings`: reservas confirmadas/activas y ciclo operativo.
- `payments`: intentos, estados financieros, identificadores Stripe y reembolsos.
- `stripe-accounts`: estado de onboarding de cada operador.

## Modelo de ocupación

Un parking tiene una capacidad compartida y cada reserva consume una plaza lógica durante el intervalo `[entry_at, exit_at)`. Dos intervalos se solapan si `A.entry_at < B.exit_at AND A.exit_at > B.entry_at`.

Capacidad vendible = `total_capacity - operational_buffer`. Para crear un hold, la función de base de datos bloquea la instalación, cuenta reservas que se solapan y holds activos/no expirados, valida capacidad y crea el hold antes de liberar el bloqueo. Todas las rutas de escritura futuras deben mantener esta regla.

La V1 usa capacidad compartida por instalación. El esquema permite evolucionar después a pools de capacidad por modalidad de servicio, pero no se implementa esa complejidad inicialmente.

## Estados

### Hold

`active -> consumed | expired | released`

Un hold `active` solo ocupa capacidad mientras `expires_at > now()`. Los holds expirados dejan de bloquear disponibilidad incluso antes de que un proceso los marque físicamente como `expired`.

### Reserva

`confirmed -> active -> completed`

Desde `confirmed` o `active` también puede pasar a `cancelled` según una política definida por backend. No crear una reserva confirmada en el cliente.

### Pago

`pending -> processing | succeeded | failed | cancelled | partially_refunded | refunded`

Los nombres concretos de estados de Stripe se normalizan en el servicio de pagos. Los webhooks se verifican con la firma de Stripe y se registran por `event_id` para idempotencia.

## Secuencia de reserva

1. API valida usuario y entradas.
2. API invoca `create_booking_hold` autenticada.
3. PostgreSQL serializa la comprobación de capacidad para la instalación.
4. API crea una sesión de Stripe Checkout ligada al hold y persiste el intento de pago.
5. Stripe envía webhook firmado.
6. Manejador idempotente verifica el evento y el estado real en Stripe.
7. Una única transacción consume el hold, crea la reserva y actualiza el pago.
8. Notificación se envía después de confirmar la transacción.

Si el pago falla o vence, se libera el hold. No confiar en una URL de éxito del navegador para confirmar pagos.

## Seguridad y despliegue

- RLS activa en todas las tablas expuestas.
- Lectura pública limitada a aeropuertos, instalaciones y servicios activos.
- Cliente solo puede leer sus vehículos, holds, reservas y pagos propios.
- Operador solo puede gestionar recursos de su propia cuenta.
- El webhook Stripe utiliza credenciales de servidor y firma verificada.
- `service_role` solo en entornos de servidor; nunca en el navegador.
- Desarrollo, staging y producción separados.
