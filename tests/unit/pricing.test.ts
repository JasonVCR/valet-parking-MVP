import { describe, it, expect } from "vitest";
import {
  computeBillableUnits,
  computeTotalAmount,
  formatMoney,
} from "@/lib/pricing";

describe("Pricing Calculations (Integer Minor Units)", () => {
  const baseEntry = "2026-06-01T10:00:00Z";

  describe("computeBillableUnits", () => {
    it("returns 1 unit for per_stay regardless of duration", () => {
      const exitShort = "2026-06-01T12:00:00Z"; // 2 hours
      const exitLong = "2026-06-15T10:00:00Z"; // 14 days

      expect(computeBillableUnits("per_stay", baseEntry, exitShort)).toBe(1);
      expect(computeBillableUnits("per_stay", baseEntry, exitLong)).toBe(1);
    });

    it("calculates per_day using ceiling rounding (partial day counts as full day)", () => {
      // Exactly 1 day (24 hours)
      const exit24h = "2026-06-02T10:00:00Z";
      expect(computeBillableUnits("per_day", baseEntry, exit24h)).toBe(1);

      // 24 hours + 1 minute -> 2 days
      const exit24h1m = "2026-06-02T10:01:00Z";
      expect(computeBillableUnits("per_day", baseEntry, exit24h1m)).toBe(2);

      // 3 days
      const exit3d = "2026-06-04T10:00:00Z";
      expect(computeBillableUnits("per_day", baseEntry, exit3d)).toBe(3);
    });

    it("calculates per_hour using ceiling rounding", () => {
      // Exactly 1 hour
      const exit1h = "2026-06-01T11:00:00Z";
      expect(computeBillableUnits("per_hour", baseEntry, exit1h)).toBe(1);

      // 1 hour and 5 minutes -> 2 hours
      const exit1h5m = "2026-06-01T11:05:00Z";
      expect(computeBillableUnits("per_hour", baseEntry, exit1h5m)).toBe(2);

      // 5 hours
      const exit5h = "2026-06-01T15:00:00Z";
      expect(computeBillableUnits("per_hour", baseEntry, exit5h)).toBe(5);
    });

    it("throws RangeError if exit_at <= entry_at", () => {
      expect(() =>
        computeBillableUnits("per_day", baseEntry, baseEntry)
      ).toThrow(RangeError);

      const pastExit = "2026-05-31T10:00:00Z";
      expect(() =>
        computeBillableUnits("per_day", baseEntry, pastExit)
      ).toThrow(RangeError);
    });
  });

  describe("computeTotalAmount", () => {
    it("multiplies unitPriceAmount by units maintaining integer minor units", () => {
      // e.g. 1550 cents (15.50 EUR) * 3 days = 4650 cents (46.50 EUR)
      expect(computeTotalAmount(1550, 3)).toBe(4650);
      expect(computeTotalAmount(2000, 1)).toBe(2000);
      expect(computeTotalAmount(0, 5)).toBe(0); // free promo
    });

    it("throws RangeError for invalid unit prices or non-positive units", () => {
      expect(() => computeTotalAmount(-100, 2)).toThrow(RangeError);
      expect(() => computeTotalAmount(15.5, 2)).toThrow(RangeError); // floats rejected
      expect(() => computeTotalAmount(1000, 0)).toThrow(RangeError);
      expect(() => computeTotalAmount(1000, -1)).toThrow(RangeError);
    });
  });

  describe("formatMoney", () => {
    it("formats minor units to currency string", () => {
      const formatted = formatMoney(4650, "EUR", "es-ES");
      // Formatted with euro symbol and comma decimal separator
      expect(formatted).toContain("46,50");
      expect(formatted).toContain("€");
    });
  });
});
