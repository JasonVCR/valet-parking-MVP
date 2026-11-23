/**
 * Server-side commercial inquiry service.
 *
 * Implements real commercial inquiry persistence for operators/facilities
 * that do not support automated real-time booking holds.
 *
 * Enforces:
 * - Data validation & length constraints.
 * - Idempotent deduplication via deterministic SHA-256 key.
 * - Zero booking hold creation (no hold is ever created for unverified quotes).
 */

"use server";

import { z } from "zod";
import { createHash } from "crypto";

const isValidId = (val: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) ||
  /^demo-[a-z0-9-]+$/i.test(val);

export const commercialInquirySchema = z.object({
  facility_id: z.string().refine(isValidId, { message: "Identificador de instalación no válido" }),
  service_id: z.string().refine(isValidId, { message: "Identificador de servicio no válido" }).optional().nullable(),
  airport_id: z.string().refine(isValidId, { message: "Identificador de aeropuerto no válido" }).optional().nullable(),
  entry_at: z.string().datetime({ message: "Fecha de entrada no válida" }),
  exit_at: z.string().datetime({ message: "Fecha de salida no válida" }),
  contact_name: z.string().trim().min(2).max(100).optional().nullable(),
  contact_email: z.string().trim().email().optional().nullable(),
  contact_phone: z.string().trim().min(5).max(30).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export type CommercialInquiryInput = z.infer<typeof commercialInquirySchema>;

export interface CommercialInquiryResponse {
  success: boolean;
  inquiryId?: string;
  error?: string;
  code?: string;
  isDemo?: boolean;
}

function isDemoMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function submitCommercialInquiryAction(
  params: CommercialInquiryInput
): Promise<CommercialInquiryResponse> {
  const validation = commercialInquirySchema.safeParse(params);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return {
      success: false,
      error: issue ? issue.message : "Datos de consulta comercial no válidos",
      code: "VALIDATION_ERROR",
    };
  }

  const data = validation.data;

  // Compute deterministic idempotency key
  const identityPart = data.contact_email || data.contact_phone || "anonymous_lead";
  const rawKey = `${data.facility_id}:${data.service_id ?? "none"}:${data.entry_at}:${data.exit_at}:${identityPart}`;
  const idempotencyKey = createHash("sha256").update(rawKey).digest("hex");

  if (isDemoMode() || data.facility_id.startsWith("demo-")) {
    const demoInquiryId = `demo-inq-${idempotencyKey.slice(0, 12)}`;
    return {
      success: true,
      inquiryId: demoInquiryId,
      isDemo: true,
    };
  }

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data: record, error } = await supabase
      .from("commercial_inquiries")
      .upsert(
        {
          facility_id: data.facility_id,
          service_id: data.service_id || null,
          airport_id: data.airport_id || null,
          entry_at: data.entry_at,
          exit_at: data.exit_at,
          contact_name: data.contact_name || null,
          contact_email: data.contact_email || null,
          contact_phone: data.contact_phone || null,
          notes: data.notes || null,
          idempotency_key: idempotencyKey,
        },
        { onConflict: "idempotency_key" }
      )
      .select("id")
      .single();

    if (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || "DB_ERROR",
      };
    }

    return {
      success: true,
      inquiryId: record.id,
      isDemo: false,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al procesar consulta comercial",
      code: "SERVER_ERROR",
    };
  }
}
