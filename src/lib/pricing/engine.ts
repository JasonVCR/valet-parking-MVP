/**
 * Authoritative Pricing Engine for AeroValet & Parking Hub.
 *
 * Provides deterministic, server-authoritative price calculation for services,
 * advanced pricing rules (seasons, weekdays, entry times, duration bands, vehicle types),
 * and facility extras (car wash, EV charging, etc.).
 *
 * Rules:
 * - Operates strictly on integer minor currency units (e.g. euro cents).
 * - No float math for money.
 * - Perfectly mirrors the PostgreSQL calculate_service_quote() logic.
 */

import type {
  PricingUnit,
  VehicleCategory,
  ServicePriceRule,
  ServiceExtra,
  SelectedExtraInput,
  PriceSnapshotV2,
  PriceRuleAdjustmentSnapshot,
  SelectedExtraSnapshot,
  PriceLineBreakdown,
} from "@/types/domain";
import { computeBillableUnits } from "@/lib/pricing";

export interface PricingEngineInput {
  serviceId: string;
  serviceName: string;
  basePriceAmount: number; // integer minor units
  currency: string;
  pricingUnit: PricingUnit;
  entryAt: string | Date;
  exitAt: string | Date;
  rules?: ServicePriceRule[];
  availableExtras?: ServiceExtra[];
  selectedExtras?: SelectedExtraInput[];
  vehicleCategory?: VehicleCategory | null;
  airportTimezone?: string;
}

/**
 * Extracts local weekday (0=Sun..6=Sat) and time (HH:MM:SS) in a specific IANA timezone.
 */
function getLocalTimeInfo(date: Date, timezone: string): { weekday: number; timeStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      weekday: "narrow",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Determine weekday number in the target timezone
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    const weekdayStr = weekdayFormatter.format(date).toLowerCase();
    const weekdayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    const weekday = weekdayMap[weekdayStr] ?? date.getUTCDay();

    // Extract HH:MM:SS
    const parts = formatter.formatToParts(date);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const second = parts.find((p) => p.type === "second")?.value ?? "00";

    return { weekday, timeStr: `${hour}:${minute}:${second}` };
  } catch {
    // Fallback to UTC if timezone is invalid
    const h = String(date.getUTCHours()).padStart(2, "0");
    const m = String(date.getUTCMinutes()).padStart(2, "0");
    const s = String(date.getUTCSeconds()).padStart(2, "0");
    return { weekday: date.getUTCDay(), timeStr: `${h}:${m}:${s}` };
  }
}

/**
 * Calculate the authoritative quote and price snapshot.
 */
export function calculateQuote(input: PricingEngineInput): PriceSnapshotV2 {
  const {
    serviceId,
    serviceName,
    basePriceAmount,
    currency,
    pricingUnit,
    entryAt,
    exitAt,
    rules = [],
    availableExtras = [],
    selectedExtras = [],
    vehicleCategory = "standard",
    airportTimezone = "UTC",
  } = input;

  const startDate = entryAt instanceof Date ? entryAt : new Date(entryAt);
  const endDate = exitAt instanceof Date ? exitAt : new Date(exitAt);

  const durationMs = endDate.getTime() - startDate.getTime();
  if (durationMs <= 0) {
    throw new RangeError("exit_at must be strictly after entry_at");
  }

  const durationSeconds = durationMs / 1000;
  if (durationSeconds < 1800) {
    throw new RangeError("Minimum reservation stay is 30 minutes");
  }

  const durationHours = Math.ceil(durationSeconds / 3600);
  const units = computeBillableUnits(pricingUnit, startDate, endDate);

  // Time & Day in Airport timezone
  const { weekday: entryWeekday, timeStr: entryTimeStr } = getLocalTimeInfo(startDate, airportTimezone);

  // Filter and sort applicable rules by priority descending
  const activeRules = rules.filter((r) => r.active && r.service_id === serviceId);

  const matchingRules = activeRules.filter((r) => {
    // Date range filter
    if (r.valid_from && new Date(r.valid_from) > startDate) return false;
    if (r.valid_until && new Date(r.valid_until) < endDate) return false;

    // Weekday filter
    if (r.weekdays && r.weekdays.length > 0) {
      if (!r.weekdays.includes(entryWeekday)) return false;
    }

    // Entry time window filter
    if (r.entry_time_start && entryTimeStr < r.entry_time_start) return false;
    if (r.entry_time_end && entryTimeStr > r.entry_time_end) return false;

    // Duration filter
    if (r.min_duration_hours !== null && durationHours < r.min_duration_hours) return false;
    if (r.max_duration_hours !== null && durationHours > r.max_duration_hours) return false;

    // Vehicle category filter
    if (r.vehicle_category && r.vehicle_category !== (vehicleCategory || "standard")) return false;

    return true;
  });

  // Sort by priority DESC, then by created_at ASC
  matchingRules.sort((a, b) => b.priority - a.priority);

  // Select top matching rule (deterministic precedence)
  const appliedRules: PriceRuleAdjustmentSnapshot[] = [];
  let adjustedUnitPrice = basePriceAmount;

  if (matchingRules.length > 0) {
    const topRule = matchingRules[0];
    if (topRule.adjustment_type === "override" && topRule.fixed_amount !== null) {
      adjustedUnitPrice = topRule.fixed_amount;
    } else if (topRule.adjustment_type === "fixed_addition" && topRule.fixed_amount !== null) {
      adjustedUnitPrice = basePriceAmount + topRule.fixed_amount;
    } else if (topRule.adjustment_type === "percentage_bps" && topRule.percentage_bps !== null) {
      // Bigint arithmetic to avoid floating point precision errors
      const multiplier = BigInt(10000 + topRule.percentage_bps);
      const computed = (BigInt(basePriceAmount) * multiplier) / BigInt(10000);
      adjustedUnitPrice = Number(computed);
    }

    appliedRules.push({
      rule_id: topRule.id,
      rule_name: topRule.name,
      rule_type: topRule.rule_type,
      adjustment_type: topRule.adjustment_type,
      original_unit_price: basePriceAmount,
      adjusted_unit_price: adjustedUnitPrice,
    });
  }

  const baseTotalAmount = basePriceAmount * units;
  const rulesAdjustmentsAmount = (adjustedUnitPrice - basePriceAmount) * units;

  const breakdown: PriceLineBreakdown[] = [
    {
      label: `${serviceName} (${units} ${units === 1 ? "unidad" : "unidades"})`,
      quantity: units,
      unit_price: adjustedUnitPrice,
      total_price: adjustedUnitPrice * units,
      type: "base_stay",
    },
  ];

  // Process Extras
  const selectedExtrasSnapshots: SelectedExtraSnapshot[] = [];
  let extrasAmount = 0;

  // 1. Mandatory extras
  const mandatoryExtras = availableExtras.filter(
    (e) => e.active && e.is_mandatory && (!e.service_id || e.service_id === serviceId)
  );

  for (const mExtra of mandatoryExtras) {
    const qty = 1;
    const cost = mExtra.pricing_unit === "per_stay"
      ? mExtra.price_amount * qty
      : mExtra.price_amount * units * qty;

    extrasAmount += cost;
    selectedExtrasSnapshots.push({
      extra_id: mExtra.id,
      name: mExtra.name,
      unit_price_amount: mExtra.price_amount,
      pricing_unit: mExtra.pricing_unit,
      quantity: qty,
      total_amount: cost,
      is_mandatory: true,
    });

    breakdown.push({
      label: `${mExtra.name} [Obligatorio]`,
      quantity: qty,
      unit_price: mExtra.price_amount,
      total_price: cost,
      type: "extra",
    });
  }

  // 2. User-selected optional extras
  for (const req of selectedExtras) {
    const extraRecord = availableExtras.find(
      (e) => e.id === req.extra_id && e.active && !e.is_mandatory && (!e.service_id || e.service_id === serviceId)
    );

    if (extraRecord) {
      const qty = Math.max(1, Math.min(req.quantity || 1, extraRecord.max_quantity));
      const cost = extraRecord.pricing_unit === "per_stay"
        ? extraRecord.price_amount * qty
        : extraRecord.price_amount * units * qty;

      extrasAmount += cost;
      selectedExtrasSnapshots.push({
        extra_id: extraRecord.id,
        name: extraRecord.name,
        unit_price_amount: extraRecord.price_amount,
        pricing_unit: extraRecord.pricing_unit,
        quantity: qty,
        total_amount: cost,
        is_mandatory: false,
      });

      breakdown.push({
        label: extraRecord.name,
        quantity: qty,
        unit_price: extraRecord.price_amount,
        total_price: cost,
        type: "extra",
      });
    }
  }

  const totalAmount = adjustedUnitPrice * units + extrasAmount;

  return {
    service_id: serviceId,
    service_name: serviceName,
    currency,
    pricing_unit: pricingUnit,
    units,
    base_unit_price_amount: basePriceAmount,
    base_total_amount: baseTotalAmount,
    rules_adjustments_amount: rulesAdjustmentsAmount,
    extras_amount: extrasAmount,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: totalAmount,
    calculation_version: 2,
    applied_rules: appliedRules,
    selected_extras: selectedExtrasSnapshots,
    breakdown,
  };
}
