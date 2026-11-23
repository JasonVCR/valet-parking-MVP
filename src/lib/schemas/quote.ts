import { z } from "zod";

const isValidId = (val: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) ||
  /^demo-[a-z0-9-]+$/i.test(val);

export const getServiceQuoteSchema = z
  .object({
    facility_id: z.string().refine(isValidId, { message: "Identificador de instalación no válido" }),
    service_id: z.string().refine(isValidId, { message: "Identificador de servicio no válido" }),
    entry_at: z.string().datetime({ message: "Fecha de entrada no válida" }),
    exit_at: z.string().datetime({ message: "Fecha de salida no válida" }),
    vehicle_category: z.enum(["standard", "suv", "van", "motorcycle"]).optional().nullable(),
    selected_extras: z
      .array(
        z.object({
          extra_id: z.string().refine(isValidId, { message: "Identificador de extra no válido" }),
          quantity: z.number().int().min(1).max(10).default(1),
        })
      )
      .optional()
      .default([]),
  })
  .superRefine((data, ctx) => {
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

    if (exit <= entry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "La fecha de salida debe ser posterior a la de entrada",
      });
      return;
    }

    const duration = exit - entry;
    if (duration < 30 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "La estancia mínima es de 30 minutos",
      });
    }
  });

export type GetServiceQuoteInput = z.infer<typeof getServiceQuoteSchema>;
