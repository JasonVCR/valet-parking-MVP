/**
 * Domain types for Valet Parking MVP.
 *
 * These types mirror the PostgreSQL schema defined in
 * supabase/migrations/20261017000100_initial_schema.sql.
 *
 * Rules:
 * - Money is always bigint (integer minor units, e.g. euro cents). Never float.
 * - All timestamps are ISO-8601 strings when crossing the API boundary.
 * - Enums mirror PostgreSQL enum types exactly.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type OperatorStatus = "pending" | "active" | "suspended";

export type PricingUnit = "per_stay" | "per_day" | "per_hour";

export type PriceRuleType =
  | "season"
  | "weekday"
  | "time_band"
  | "duration_band"
  | "vehicle_category";

export type PriceAdjustmentType =
  | "override"
  | "fixed_addition"
  | "percentage_bps";

export type ExtraPricingUnit = "per_stay" | "per_day";

export type VehicleCategory = "standard" | "suv" | "van" | "motorcycle";

export type HoldStatus = "active" | "consumed" | "expired" | "released";

export type BookingStatus = "confirmed" | "active" | "completed" | "cancelled";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "partially_refunded"
  | "refunded";

// ─── Core entities ────────────────────────────────────────────────────────────

export interface Airport {
  id: string;
  iata_code: string; // 3 uppercase letters
  name: string;
  city: string;
  country_code: string; // 2 letters
  timezone: string; // IANA timezone string
  active: boolean;
  created_at: string;
}

export interface Operator {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  country_code: string;
  currency: string; // ISO 4217, 3 uppercase letters
  status: OperatorStatus;
  platform_fee_bps: number; // basis points 0–10000
  created_at: string;
  updated_at: string;
}

export interface Facility {
  id: string;
  operator_id: string;
  airport_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  total_capacity: number;
  operational_buffer: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  facility_id: string;
  name: string;
  description: string | null;
  /** Integer in minor currency units (e.g. euro cents). Never a float. */
  price_amount: number;
  currency: string;
  pricing_unit: PricingUnit;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServicePriceRule {
  id: string;
  service_id: string;
  name: string;
  rule_type: PriceRuleType;
  priority: number;
  valid_from: string | null;
  valid_until: string | null;
  weekdays: number[] | null;
  entry_time_start: string | null;
  entry_time_end: string | null;
  min_duration_hours: number | null;
  max_duration_hours: number | null;
  vehicle_category: VehicleCategory | null;
  adjustment_type: PriceAdjustmentType;
  fixed_amount: number | null;
  percentage_bps: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceExtra {
  id: string;
  facility_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  price_amount: number;
  currency: string;
  pricing_unit: ExtraPricingUnit;
  is_mandatory: boolean;
  max_quantity: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRule {
  id: string;
  facility_id: string;
  /** 0 = Sunday … 6 = Saturday (matches PostgreSQL EXTRACT(DOW)) */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  opens_at: string; // HH:MM:SS
  closes_at: string; // HH:MM:SS
  valid_from: string | null; // ISO date
  valid_until: string | null; // ISO date
  active: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Price snapshot & Breakdown ──────────────────────────────────────────────

export interface PriceRuleAdjustmentSnapshot {
  rule_id: string;
  rule_name: string;
  rule_type: PriceRuleType;
  adjustment_type: PriceAdjustmentType;
  original_unit_price: number;
  adjusted_unit_price: number;
}

export interface SelectedExtraSnapshot {
  extra_id: string;
  name: string;
  unit_price_amount: number;
  pricing_unit: ExtraPricingUnit;
  quantity: number;
  total_amount: number;
  is_mandatory: boolean;
}

export interface PriceLineBreakdown {
  label: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  type: "base_stay" | "season_surcharge" | "weekday_adjustment" | "duration_discount" | "extra" | "tax";
}

export interface PriceSnapshotV1 {
  service_id: string;
  service_name: string;
  unit_price_amount: number;
  pricing_unit: PricingUnit;
  units: number;
  total_amount: number;
  currency: string;
  calculation_version: 1;
}

export interface PriceSnapshotV2 {
  service_id: string;
  service_name: string;
  currency: string;
  pricing_unit: PricingUnit;
  units: number;
  base_unit_price_amount: number;
  base_total_amount: number;
  rules_adjustments_amount: number;
  extras_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  calculation_version: 2;
  applied_rules: PriceRuleAdjustmentSnapshot[];
  selected_extras: SelectedExtraSnapshot[];
  breakdown: PriceLineBreakdown[];
}

export type PriceSnapshot = PriceSnapshotV1 | PriceSnapshotV2;

// ─── Holds & Bookings ────────────────────────────────────────────────────────

export interface BookingHold {
  id: string;
  customer_id: string | null;
  guest_email?: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  facility_id: string;
  service_id: string;
  vehicle_id: string | null;
  entry_at: string;
  exit_at: string;
  status: HoldStatus;
  expires_at: string;
  /** Integer minor units */
  price_amount: number;
  currency: string;
  price_snapshot: PriceSnapshot;
  created_at: string;
  updated_at: string;
}

export interface SelectedExtraInput {
  extra_id: string;
  quantity: number;
}

export interface CreateHoldParams {
  facility_id: string;
  service_id: string;
  entry_at: string;
  exit_at: string;
  vehicle_id?: string | null;
  customer_id?: string | null;
  guest_email?: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  vehicle_category?: VehicleCategory | null;
  selected_extras?: SelectedExtraInput[];
}

export interface HoldResult {
  hold_id: string;
  facility_id: string;
  service_id: string;
  entry_at: string;
  exit_at: string;
  status: HoldStatus;
  expires_at: string;
  price_amount: number;
  currency: string;
  pricing_unit: PricingUnit;
  units: number;
  price_snapshot?: PriceSnapshot;
}

export interface Booking {
  id: string;
  booking_reference: string;
  hold_id: string;
  customer_id: string;
  facility_id: string;
  service_id: string;
  vehicle_id: string | null;
  entry_at: string;
  exit_at: string;
  status: BookingStatus;
  customer_name_snapshot: string;
  customer_email_snapshot: string;
  customer_phone_snapshot: string | null;
  /** Integer minor units */
  price_amount: number;
  currency: string;
  price_snapshot: PriceSnapshot;
  confirmed_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Search / API result types ───────────────────────────────────────────────

/**
 * A facility with its active services — the unit returned by the search API.
 * Never includes capacity numbers or holds (those stay server-side).
 */
export interface FacilityWithServices extends Facility {
  operator: Pick<Operator, "id" | "name" | "currency">;
  services: Service[];
}

/**
 * Validated parameters for the search query.
 * entry_at and exit_at are ISO-8601 UTC strings.
 */
export interface SearchParams {
  airport_id: string;
  entry_at: string;
  exit_at: string;
}

// ─── Legal Documents & Terms Versioning ───────────────────────────────────────

export type LegalDocumentScope = "platform" | "operator";

export type LegalDocumentType =
  | "platform_terms"
  | "privacy_policy"
  | "operator_terms"
  | "cancellation_policy";

export type LegalDocumentStatus = "draft" | "published" | "archived";

export interface LegalDocument {
  id: string;
  scope: LegalDocumentScope;
  operator_id: string | null;
  document_type: LegalDocumentType;
  version: string;
  language: string;
  title: string;
  content_markdown: string;
  sha256_hash: string;
  status: LegalDocumentStatus;
  effective_from: string | null;
  effective_until: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CancellationPolicyRule {
  id: string;
  operator_id: string;
  legal_document_id: string;
  free_cancellation_window_hours: number;
  late_cancellation_fee_bps: number;
  no_show_fee_bps: number;
  allow_modifications: boolean;
  modification_window_hours: number;
  active: boolean;
  created_at: string;
}

export interface BookingTermsSnapshot {
  hold_id: string;
  platform_terms_id: string;
  platform_terms_version: string;
  platform_terms_hash: string;
  privacy_policy_id: string;
  privacy_policy_version: string;
  privacy_policy_hash: string;
  operator_terms_id: string | null;
  operator_terms_version: string | null;
  operator_terms_hash: string | null;
  cancellation_policy_rule_id: string | null;
  cancellation_policy_snapshot: CancellationPolicyRule | null;
  created_at: string;
}

export interface BookingAcceptanceInput {
  document_id: string;
  version: string;
  hash: string;
}

export interface BookingAcceptance {
  id: string;
  hold_id: string;
  booking_id: string | null;
  customer_id: string | null;
  document_id: string;
  document_version: string;
  document_hash: string;
  accepted_at: string;
  ip_address_hash: string | null;
  user_agent_summary: string | null;
  created_at: string;
}
