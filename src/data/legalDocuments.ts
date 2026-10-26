/**
 * Default Legal Documents and Policy Rules for AeroValet & Parking Hub.
 *
 * NOTE: These documents are preliminary draft placeholders prepared for technical
 * validation. They are subject to final legal review and privacy counsel approval.
 * None of this text is copied from third parties.
 */

import { createHash } from "crypto";
import type { LegalDocument, CancellationPolicyRule } from "@/types/domain";

export function computeSha256(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}

export const DRAFT_PLATFORM_TERMS_CONTENT = `
# [BORRADOR LEGAL SUJETO A REVISIÓN] — Condiciones Generales de Uso de AeroValet & Parking Hub

**Versión:** 1.0  
**Fecha de vigencia:** 26 de octubre de 2026  
**Ámbito:** Plataforma AeroValet & Parking Hub  

1. **Objeto de la plataforma**  
AeroValet & Parking Hub opera como una plataforma tecnológica de mediación e intermediación digital que conecta a usuarios conductores con operadores independientes de aparcamientos y servicios de aparcacoches (valet) en las inmediaciones de recintos aeroportuarios.

2. **Rol de AeroValet**  
AeroValet no es el propietario, arrendatario ni custodio material de los vehículos en las instalaciones de aparcamiento, salvo indicación expresa contraria. Cada servicio de estacionamiento o valet es ejecutado directamente por el Operador designado en la reserva.

3. **Reservas, Bloqueo de Capacidad y Pasarela de Pago**  
La solicitud de plaza a través de AeroValet genera una asignación temporal de capacidad (*hold*) con una vigencia máxima de quince (15) minutos. La confirmación definitiva queda condicionada a la verificación y cobro íntegro del importe estipulado.

4. **Transparencia de Precios y Modificaciones**  
El desglose de tarifa incluye el precio base del operador, los suplementos aplicables por temporada o franja horaria, y los servicios extras opcionales contratados. No existen costes ocultos al momento de formalizar el pago.

5. **Jurisdicción y Ley Aplicable**  
Las presentes condiciones se rigen por la legislación española y la normativa comunitaria de protección a consumidores y usuarios.
`.trim();

export const DRAFT_PRIVACY_POLICY_CONTENT = `
# [BORRADOR LEGAL SUJETO A REVISIÓN] — Política de Privacidad y Protección de Datos

**Versión:** 1.0  
**Fecha de vigencia:** 26 de octubre de 2026  
**Responsable del Tratamiento:** AeroValet Platform S.L. (en constitución)  

1. **Finalidad del tratamiento**  
Los datos identificativos, de contacto (nombre, correo electrónico, teléfono) y del vehículo (matrícula, modelo) se tratan exclusivamente con la finalidad de gestionar la reserva de plaza, bloquear la capacidad ante el operador y remitir la confirmación del servicio.

2. **Base jurídica**  
El tratamiento se fundamenta en la ejecución de la relación contractual o precontractual (artículo 6.1.b RGPD). La aceptación de esta política no se vincula a consentimientos de comunicaciones comerciales o marketing, los cuales requerirán consentimiento explícito e independiente.

3. **Destinatarios de los datos**  
Los datos estrictamente necesarios para la operativa de recepción y entrega del vehículo son comunicados al Operador de aparcamiento seleccionado por el usuario.

4. **Derechos del interesado**  
Usted puede ejercer sus derechos de acceso, rectificación, supresión, limitación y oposición dirigiendo una solicitud a privacidad@aerovalet.demo.
`.trim();

export const DRAFT_OPERATOR_TERMS_CONTENT = `
# [BORRADOR LEGAL SUJETO A REVISIÓN] — Condiciones Generales del Operador de Aparcamiento

**Versión:** 1.0  
**Fecha de vigencia:** 26 de octubre de 2026  
**Ámbito:** Operador del Servicio de Aparcamiento / Valet  

1. **Recepción e Inspección del Vehículo**  
Al momento de la entrega del vehículo en la terminal o instalación, el personal del operador realizará una inspección ocular del estado exterior del vehículo junto con el conductor.

2. **Custodia y Seguro de Responsabilidad Civil**  
El operador mantiene una póliza de seguro de responsabilidad civil vigente para cubrir los daños directos acaecidos durante el periodo de custodia y maniobra del vehículo bajo su control exclusivo.

3. **Puntualidad y Avisos de Retraso de Vuelos**  
El usuario se compromete a comunicar cualquier cambio sustancial en la hora de llegada de su vuelo para garantizar la disponibilidad inmediata del personal de entrega.
`.trim();

export const DRAFT_CANCELLATION_POLICY_CONTENT = `
# [BORRADOR LEGAL SUJETO A REVISIÓN] — Política de Cancelaciones y Modificaciones

**Versión:** 1.0  
**Fecha de vigencia:** 26 de octubre de 2026  

1. **Cancelación Gratuita**  
El cliente tiene derecho a la cancelación sin penalización y al reembolso del 100% del importe abonado si la cancelación se solicita con al menos veinticuatro (24) horas de antelación a la hora de entrada reservada.

2. **Cancelación Tardía**  
Si la cancelación se solicita con menos de veinticuatro (24) horas de antelación, se aplicará una penalización del 50% en concepto de gastos de reserva y bloqueo de plaza, reembolsándose el 50% restante.

3. **No Presentación (No-Show)**  
En caso de que el cliente no se presente a la hora convenida sin previo aviso ni cancelación formal, no procederá reembolso alguno (penalización del 100%).

4. **Modificaciones de Reserva**  
Se permiten modificaciones en las fechas y horarios hasta dos (2) horas antes del inicio del servicio, sujetas a disponibilidad de plaza y reajuste de tarifa si procede.
`.trim();

// Pre-computed documents with immutable SHA-256 hashes
export const PLATFORM_TERMS_DOCUMENT: LegalDocument = {
  id: "00000000-0000-4000-b000-000000000001",
  scope: "platform",
  operator_id: null,
  document_type: "platform_terms",
  version: "1.0",
  language: "es",
  title: "Términos y Condiciones Generales de Uso de AeroValet",
  content_markdown: DRAFT_PLATFORM_TERMS_CONTENT,
  sha256_hash: computeSha256(DRAFT_PLATFORM_TERMS_CONTENT),
  status: "published",
  effective_from: "2026-10-26T00:00:00Z",
  effective_until: null,
  published_at: "2026-10-26T00:00:00Z",
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
};

export const PRIVACY_POLICY_DOCUMENT: LegalDocument = {
  id: "00000000-0000-4000-b000-000000000002",
  scope: "platform",
  operator_id: null,
  document_type: "privacy_policy",
  version: "1.0",
  language: "es",
  title: "Política de Privacidad y Protección de Datos",
  content_markdown: DRAFT_PRIVACY_POLICY_CONTENT,
  sha256_hash: computeSha256(DRAFT_PRIVACY_POLICY_CONTENT),
  status: "published",
  effective_from: "2026-10-26T00:00:00Z",
  effective_until: null,
  published_at: "2026-10-26T00:00:00Z",
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
};

export const CANCELLATION_POLICY_DOCUMENT: LegalDocument = {
  id: "00000000-0000-4000-b000-000000000003",
  scope: "platform",
  operator_id: null,
  document_type: "cancellation_policy",
  version: "1.0",
  language: "es",
  title: "Política de Cancelación y Reembolso",
  content_markdown: DRAFT_CANCELLATION_POLICY_CONTENT,
  sha256_hash: computeSha256(DRAFT_CANCELLATION_POLICY_CONTENT),
  status: "published",
  effective_from: "2026-10-26T00:00:00Z",
  effective_until: null,
  published_at: "2026-10-26T00:00:00Z",
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
};

export const DEFAULT_CANCELLATION_RULE: CancellationPolicyRule = {
  id: "00000000-0000-4000-b000-000000000010",
  operator_id: "00000000-0000-4000-a000-000000000001",
  legal_document_id: CANCELLATION_POLICY_DOCUMENT.id,
  free_cancellation_window_hours: 24,
  late_cancellation_fee_bps: 5000, // 50% fee
  no_show_fee_bps: 10000, // 100% fee
  allow_modifications: true,
  modification_window_hours: 2,
  active: true,
  created_at: "2026-10-26T00:00:00Z",
};

/**
 * Calculates refund and penalty for a cancellation request according to rule.
 * Operates on integer minor units.
 */
export function evaluateCancellationRefund(
  rule: CancellationPolicyRule,
  entryAt: string | Date,
  cancellationAt: string | Date,
  totalPaidAmount: number
): { refundAmount: number; penaltyAmount: number; isFreeCancellation: boolean } {
  const entryDate = entryAt instanceof Date ? entryAt : new Date(entryAt);
  const cancelDate = cancellationAt instanceof Date ? cancellationAt : new Date(cancellationAt);

  const hoursUntilEntry = (entryDate.getTime() - cancelDate.getTime()) / (1000 * 60 * 60);

  if (hoursUntilEntry >= rule.free_cancellation_window_hours) {
    // 100% Refund
    return {
      refundAmount: totalPaidAmount,
      penaltyAmount: 0,
      isFreeCancellation: true,
    };
  } else if (hoursUntilEntry > 0) {
    // Late Cancellation Penalty
    const penalty = Math.round((totalPaidAmount * rule.late_cancellation_fee_bps) / 10000);
    const refund = Math.max(0, totalPaidAmount - penalty);
    return {
      refundAmount: refund,
      penaltyAmount: penalty,
      isFreeCancellation: false,
    };
  } else {
    // No-show (entry time already passed)
    const penalty = Math.round((totalPaidAmount * rule.no_show_fee_bps) / 10000);
    const refund = Math.max(0, totalPaidAmount - penalty);
    return {
      refundAmount: refund,
      penaltyAmount: penalty,
      isFreeCancellation: false,
    };
  }
}
