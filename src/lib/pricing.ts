/**
 * Pricing calculation utilities.
 *
 * IMPORTANT:
 * - These functions operate on **integer minor currency units** (e.g. euro cents).
 * - No floating-point arithmetic for money; we use Math.ceil on pure seconds.
 * - price_amount from the DB is always a bigint-compatible integer.
 * - The server validates these same rules in create_booking_hold(); the client
 *   NEVER sends computed prices as authoritative values.
 */

import type { PricingUnit } from "@/types/domain";

const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/**
 * Compute the number of billable units for a stay.
 *
 * Mirrors the PostgreSQL calculation in create_booking_hold():
 *   per_stay → 1
 *   per_day  → max(1, ceil(duration_seconds / 86400))
 *   per_hour → max(1, ceil(duration_seconds / 3600))
 *
 * @param pricingUnit - the service's billing cadence
 * @param entryAt     - stay start (Date or ISO string)
 * @param exitAt      - stay end  (Date or ISO string)
 * @returns integer number of units (≥ 1)
 */
export function computeBillableUnits(
  pricingUnit: PricingUnit,
  entryAt: Date | string,
  exitAt: Date | string
): number {
  const start = entryAt instanceof Date ? entryAt : new Date(entryAt);
  const end = exitAt instanceof Date ? exitAt : new Date(exitAt);
  const durationSeconds = (end.getTime() - start.getTime()) / 1_000;

  if (durationSeconds <= 0) {
    throw new RangeError("exit_at must be after entry_at");
  }

  switch (pricingUnit) {
    case "per_stay":
      return 1;
    case "per_day":
      return Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_DAY));
    case "per_hour":
      return Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_HOUR));
    default:
      // TypeScript exhaustiveness guard
      pricingUnit satisfies never;
      throw new Error(`Unknown pricing unit: ${pricingUnit}`);
  }
}

/**
 * Compute the total price in integer minor units.
 *
 * @param unitPriceAmount - price per unit in minor units (integer, from DB)
 * @param units           - number of billable units
 * @returns total in integer minor units
 */
export function computeTotalAmount(
  unitPriceAmount: number,
  units: number
): number {
  if (!Number.isInteger(unitPriceAmount) || unitPriceAmount < 0) {
    throw new RangeError("unitPriceAmount must be a non-negative integer");
  }
  if (!Number.isInteger(units) || units < 1) {
    throw new RangeError("units must be a positive integer");
  }
  return unitPriceAmount * units;
}

/**
 * Format an integer minor-unit amount as a human-readable string.
 * This is display-only; never use this output for calculations.
 *
 * @param amount   - integer minor units (e.g. 1050 cents)
 * @param currency - ISO 4217 code (e.g. "EUR")
 * @param locale   - BCP-47 locale (defaults to "es-ES")
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale = "es-ES"
): string {
  const major = amount / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}
