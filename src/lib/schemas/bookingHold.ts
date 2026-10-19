/**
 * Zod schema for atomic booking hold creation.
 *
 * Validates parameters before invoking create_booking_hold RPC.
 * Enforces duration boundaries, future entry times, and identity.
 */

import { z } from "zod";

const MIN_STAY_MS = 30 * 60 * 1_000; // 30 minutes minimum stay
const MAX_STAY_MS = 90 * 24 * 60 * 60 * 1_000; // 90 days maximum stay


export const createBookingHoldSchema = z
  .object({
    facility_id: z.string().uuid({ message: "Identificador de instalación no válido" }),
    service_id: z.string().uuid({ message: "Identificador de servicio no válido" }),
    entry_at: z.string().datetime({ message: "Fecha de entrada no válida" }),
    exit_at: z.string().datetime({ message: "Fecha de salida no válida" }),
    vehicle_id: z.string().uuid().nullable().optional(),
    customer_id: z.string().uuid().nullable().optional(),
    guest_name: z
      .string()
      .trim()
      .min(2, { message: "El nombre debe tener al menos 2 caracteres" })
      .max(100, { message: "El nombre es demasiado largo" })
      .optional()
      .nullable(),
    guest_email: z
      .string()
      .trim()
      .email({ message: "Correo electrónico no válido" })
      .optional()
      .nullable(),
    guest_phone: z
      .string()
      .trim()
      .max(20, { message: "Teléfono no válido" })
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    const now = Date.now();
    const entry = new Date(data.entry_at).getTime();
    const exit = new Date(data.exit_at).getTime();

    if (isNaN(entry) || isNaN(exit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_at"],
        message: "Fechas no válidas",
      });
      return;
    }

    if (entry <= now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_at"],
        message: "La entrada debe ser en el futuro",
      });
    }

    if (exit <= entry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "La fecha de salida debe ser posterior a la de entrada",
      });
      return;
    }

    const duration = exit - entry;
    if (duration < MIN_STAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "La estancia mínima es de 30 minutos",
      });
    }

    if (duration > MAX_STAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "La estancia máxima no puede superar los 90 días",
      });
    }

    // Require either customer_id or valid guest contact details
    if (!data.customer_id && (!data.guest_email || !data.guest_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guest_email"],
        message: "Se requiere correo y nombre para la reserva de invitado",
      });
    }
  });

export type CreateBookingHoldInput = z.infer<typeof createBookingHoldSchema>;
export const CreateBookingHoldSchema = createBookingHoldSchema;

