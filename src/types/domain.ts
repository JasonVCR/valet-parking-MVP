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

// ─── Price snapshot ──────────────────────────────────────────────────────────

/**
 * Frozen at hold-creation time. The browser never re-computes price.
 * Matches the jsonb built in create_booking_hold().
 */
export interface PriceSnapshot {
  service_id: string;
  service_name: string;
  /** Integer minor units — never float */
  unit_price_amount: number;
  pricing_unit: PricingUnit;
  units: number;
  /** Integer minor units — never float */
  total_amount: number;
  currency: string;
  calculation_version: number;
}

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
