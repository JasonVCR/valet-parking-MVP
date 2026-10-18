import { describe, it, expect } from "vitest";

/**
 * Pure functions modeling the PostgreSQL capacity logic from
 * supabase/migrations/20261017000100_initial_schema.sql (create_booking_hold RPC).
 */
export function intervalsOverlap(
  aEntry: Date,
  aExit: Date,
  bEntry: Date,
  bExit: Date
): boolean {
  return aEntry < bExit && aExit > bEntry;
}

export function calculateSellableCapacity(
  totalCapacity: number,
  operationalBuffer: number
): number {
  return Math.max(0, totalCapacity - operationalBuffer);
}

export function isHoldActive(
  status: "active" | "consumed" | "expired" | "released",
  expiresAt: Date,
  now: Date
): boolean {
  return status === "active" && expiresAt > now;
}

export function canCreateHold(params: {
  totalCapacity: number;
  operationalBuffer: number;
  requestedEntry: Date;
  requestedExit: Date;
  existingBookings: Array<{ entry: Date; exit: Date; status: string }>;
  existingHolds: Array<{
    entry: Date;
    exit: Date;
    status: "active" | "consumed" | "expired" | "released";
    expiresAt: Date;
  }>;
  now: Date;
}): boolean {
  const sellableCapacity = calculateSellableCapacity(
    params.totalCapacity,
    params.operationalBuffer
  );

  // Active bookings overlapping
  const overlappingBookings = params.existingBookings.filter(
    (b) =>
      b.status !== "cancelled" &&
      intervalsOverlap(params.requestedEntry, params.requestedExit, b.entry, b.exit)
  ).length;

  // Active unexpired holds overlapping
  const overlappingHolds = params.existingHolds.filter(
    (h) =>
      isHoldActive(h.status, h.expiresAt, params.now) &&
      intervalsOverlap(params.requestedEntry, params.requestedExit, h.entry, h.exit)
  ).length;

  const totalOccupied = overlappingBookings + overlappingHolds;
  return totalOccupied < sellableCapacity;
}

describe("Capacity and Overlapping Intervals Rules", () => {
  const now = new Date("2026-06-01T08:00:00Z");

  describe("intervalsOverlap", () => {
    const aEntry = new Date("2026-06-01T10:00:00Z");
    const aExit = new Date("2026-06-05T10:00:00Z");

    it("detects overlap when B is inside A", () => {
      const bEntry = new Date("2026-06-02T10:00:00Z");
      const bExit = new Date("2026-06-03T10:00:00Z");
      expect(intervalsOverlap(aEntry, aExit, bEntry, bExit)).toBe(true);
    });

    it("detects overlap when B starts before and ends during A", () => {
      const bEntry = new Date("2026-05-31T10:00:00Z");
      const bExit = new Date("2026-06-02T10:00:00Z");
      expect(intervalsOverlap(aEntry, aExit, bEntry, bExit)).toBe(true);
    });

    it("does NOT overlap when B finishes exactly when A starts", () => {
      const bEntry = new Date("2026-05-30T10:00:00Z");
      const bExit = new Date("2026-06-01T10:00:00Z"); // same as aEntry
      expect(intervalsOverlap(aEntry, aExit, bEntry, bExit)).toBe(false);
    });

    it("does NOT overlap when B starts exactly when A finishes", () => {
      const bEntry = new Date("2026-06-05T10:00:00Z"); // same as aExit
      const bExit = new Date("2026-06-08T10:00:00Z");
      expect(intervalsOverlap(aEntry, aExit, bEntry, bExit)).toBe(false);
    });
  });

  describe("canCreateHold & Operational Buffer", () => {
    it("respects sellable capacity = total_capacity - operational_buffer", () => {
      // Total 10, buffer 2 -> sellable capacity 8
      const totalCapacity = 10;
      const operationalBuffer = 2;
      const reqEntry = new Date("2026-06-02T10:00:00Z");
      const reqExit = new Date("2026-06-05T10:00:00Z");

      // 7 bookings -> can create 8th
      const existingBookings = Array.from({ length: 7 }, () => ({
        entry: new Date("2026-06-01T10:00:00Z"),
        exit: new Date("2026-06-06T10:00:00Z"),
        status: "confirmed",
      }));

      expect(
        canCreateHold({
          totalCapacity,
          operationalBuffer,
          requestedEntry: reqEntry,
          requestedExit: reqExit,
          existingBookings,
          existingHolds: [],
          now,
        })
      ).toBe(true);

      // Add one more booking (total 8) -> capacity exhausted, cannot create 9th
      existingBookings.push({
        entry: new Date("2026-06-01T10:00:00Z"),
        exit: new Date("2026-06-06T10:00:00Z"),
        status: "confirmed",
      });

      expect(
        canCreateHold({
          totalCapacity,
          operationalBuffer,
          requestedEntry: reqEntry,
          requestedExit: reqExit,
          existingBookings,
          existingHolds: [],
          now,
        })
      ).toBe(false);
    });

    it("ignores expired holds and released holds", () => {
      const totalCapacity = 2;
      const operationalBuffer = 0; // sellable 2
      const reqEntry = new Date("2026-06-02T10:00:00Z");
      const reqExit = new Date("2026-06-05T10:00:00Z");

      const existingHolds = [
        {
          entry: reqEntry,
          exit: reqExit,
          status: "expired" as const,
          expiresAt: new Date("2026-06-01T07:00:00Z"), // in past
        },
        {
          entry: reqEntry,
          exit: reqExit,
          status: "active" as const,
          expiresAt: new Date("2026-06-01T07:30:00Z"), // expired even if status was active
        },
        {
          entry: reqEntry,
          exit: reqExit,
          status: "released" as const,
          expiresAt: new Date("2026-06-01T09:00:00Z"),
        },
      ];

      // Since all 3 holds are inactive/expired, capacity is available
      expect(
        canCreateHold({
          totalCapacity,
          operationalBuffer,
          requestedEntry: reqEntry,
          requestedExit: reqExit,
          existingBookings: [],
          existingHolds,
          now,
        })
      ).toBe(true);
    });
  });
});
