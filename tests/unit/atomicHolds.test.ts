import { describe, it, expect } from "vitest";
import { CreateBookingHoldSchema } from "@/lib/schemas/bookingHold";
import { intervalsOverlap, calculateSellableCapacity } from "./capacity.test";

/**
 * Timeline-based peak occupancy algorithm.
 * Models the exact behavior of `get_timeline_peak_occupancy` in
 * `supabase/migrations/20261019000100_atomic_booking_holds.sql`.
 */
export interface OccupancyInterval {
  entry: Date;
  exit: Date;
  status: string;
}

export interface HoldInterval extends OccupancyInterval {
  expiresAt: Date;
}

export function computeTimelinePeakOccupancy(params: {
  requestedEntry: Date;
  requestedExit: Date;
  existingBookings: OccupancyInterval[];
  existingHolds: HoldInterval[];
  now: Date;
}): number {
  const { requestedEntry, requestedExit, existingBookings, existingHolds, now } = params;

  // Filter valid active stays that overlap with the requested window
  const activeBookings = existingBookings.filter(
    (b) => b.status !== "cancelled" && intervalsOverlap(requestedEntry, requestedExit, b.entry, b.exit)
  );

  const activeHolds = existingHolds.filter(
    (h) =>
      h.status === "active" &&
      h.expiresAt > now &&
      intervalsOverlap(requestedEntry, requestedExit, h.entry, h.exit)
  );

  const allStays = [...activeBookings, ...activeHolds];
  if (allStays.length === 0) return 0;

  // Critical instants to evaluate:
  // 1. The requested entry point
  // 2. Any entry point of existing stays that falls within [requestedEntry, requestedExit)
  const criticalInstants = new Set<number>();
  criticalInstants.add(requestedEntry.getTime());

  for (const stay of allStays) {
    const t = stay.entry.getTime();
    if (t >= requestedEntry.getTime() && t < requestedExit.getTime()) {
      criticalInstants.add(t);
    }
  }

  // Calculate concurrent occupancy at each critical instant:
  // A stay is present at instant T if stay.entry <= T and stay.exit > T
  let maxOccupancy = 0;
  for (const instant of criticalInstants) {
    const count = allStays.filter(
      (s) => s.entry.getTime() <= instant && s.exit.getTime() > instant
    ).length;
    if (count > maxOccupancy) {
      maxOccupancy = count;
    }
  }

  return maxOccupancy;
}

export function canCreateAtomicHold(params: {
  totalCapacity: number;
  operationalBuffer: number;
  requestedEntry: Date;
  requestedExit: Date;
  existingBookings: OccupancyInterval[];
  existingHolds: HoldInterval[];
  now: Date;
}): { canHold: boolean; peakOccupancy: number; sellableCapacity: number } {
  const sellableCapacity = calculateSellableCapacity(params.totalCapacity, params.operationalBuffer);
  const peakOccupancy = computeTimelinePeakOccupancy(params);
  // We need 1 free spot at every instant of requested period, so peakOccupancy + 1 <= sellableCapacity
  const canHold = peakOccupancy < sellableCapacity;
  return { canHold, peakOccupancy, sellableCapacity };
}

describe("Atomic Booking Holds — Timeline Capacity & Concurrency", () => {
  const now = new Date("2026-10-19T10:00:00Z");

  describe("Timeline Peak Occupancy vs Naive Simple Count", () => {
    it("allows consecutive non-overlapping bookings when capacity is 1", () => {
      // Scenario:
      // Capacity = 1 spot.
      // Booking 1: 10:00 to 12:00
      // Booking 2: 12:00 to 14:00 (starts exactly when Booking 1 leaves)
      // New requested stay: 11:00 to 13:00.
      // - From 11:00 to 12:00, only Booking 1 is present (1 car).
      // - From 12:00 to 13:00, only Booking 2 is present (1 car).
      // At no point are there 2 cars simultaneously.
      const existingBookings: OccupancyInterval[] = [
        {
          entry: new Date("2026-10-20T10:00:00Z"),
          exit: new Date("2026-10-20T12:00:00Z"),
          status: "confirmed",
        },
        {
          entry: new Date("2026-10-20T12:00:00Z"),
          exit: new Date("2026-10-20T14:00:00Z"),
          status: "confirmed",
        },
      ];

      const requestedEntry = new Date("2026-10-20T11:00:00Z");
      const requestedExit = new Date("2026-10-20T13:00:00Z");

      const peak = computeTimelinePeakOccupancy({
        requestedEntry,
        requestedExit,
        existingBookings,
        existingHolds: [],
        now,
      });

      // Peak simultaneous occupancy is 1, NOT 2!
      expect(peak).toBe(1);

      // If sellable capacity is 1, adding another car would make it 2, which exceeds 1
      const resultCap1 = canCreateAtomicHold({
        totalCapacity: 1,
        operationalBuffer: 0,
        requestedEntry,
        requestedExit,
        existingBookings,
        existingHolds: [],
        now,
      });
      expect(resultCap1.canHold).toBe(false);

      // If sellable capacity is 2, peak is 1 -> 1 < 2 -> succeeds!
      const resultCap2 = canCreateAtomicHold({
        totalCapacity: 2,
        operationalBuffer: 0,
        requestedEntry,
        requestedExit,
        existingBookings,
        existingHolds: [],
        now,
      });
      expect(resultCap2.canHold).toBe(true);
    });

    it("correctly identifies overlap when two existing bookings overlap each other", () => {
      // Booking 1: 10:00 to 13:00
      // Booking 2: 11:00 to 14:00
      // At 11:30, both are present -> peak occupancy = 2
      const existingBookings: OccupancyInterval[] = [
        {
          entry: new Date("2026-10-20T10:00:00Z"),
          exit: new Date("2026-10-20T13:00:00Z"),
          status: "confirmed",
        },
        {
          entry: new Date("2026-10-20T11:00:00Z"),
          exit: new Date("2026-10-20T14:00:00Z"),
          status: "confirmed",
        },
      ];

      const peak = computeTimelinePeakOccupancy({
        requestedEntry: new Date("2026-10-20T10:30:00Z"),
        requestedExit: new Date("2026-10-20T13:30:00Z"),
        existingBookings,
        existingHolds: [],
        now,
      });

      expect(peak).toBe(2);
    });

    it("ignores cancelled bookings and expired holds", () => {
      const existingBookings: OccupancyInterval[] = [
        {
          entry: new Date("2026-10-20T10:00:00Z"),
          exit: new Date("2026-10-20T18:00:00Z"),
          status: "cancelled", // should be ignored
        },
      ];

      const existingHolds: HoldInterval[] = [
        {
          entry: new Date("2026-10-20T10:00:00Z"),
          exit: new Date("2026-10-20T18:00:00Z"),
          status: "expired", // should be ignored
          expiresAt: new Date("2026-10-19T09:00:00Z"),
        },
        {
          entry: new Date("2026-10-20T10:00:00Z"),
          exit: new Date("2026-10-20T18:00:00Z"),
          status: "active",
          expiresAt: new Date("2026-10-19T09:59:00Z"), // expired by time relative to `now`
        },
      ];

      const peak = computeTimelinePeakOccupancy({
        requestedEntry: new Date("2026-10-20T12:00:00Z"),
        requestedExit: new Date("2026-10-20T15:00:00Z"),
        existingBookings,
        existingHolds,
        now,
      });

      expect(peak).toBe(0);
    });

    it("respects operational buffer strictly", () => {
      // Total: 10, Buffer: 2 -> Sellable: 8
      const existingBookings: OccupancyInterval[] = Array.from({ length: 7 }, () => ({
        entry: new Date("2026-10-20T08:00:00Z"),
        exit: new Date("2026-10-20T20:00:00Z"),
        status: "confirmed",
      }));

      const res1 = canCreateAtomicHold({
        totalCapacity: 10,
        operationalBuffer: 2,
        requestedEntry: new Date("2026-10-20T10:00:00Z"),
        requestedExit: new Date("2026-10-20T18:00:00Z"),
        existingBookings,
        existingHolds: [],
        now,
      });
      // 7 < 8 -> can hold spot 8
      expect(res1.canHold).toBe(true);

      // Now with 8 bookings
      existingBookings.push({
        entry: new Date("2026-10-20T08:00:00Z"),
        exit: new Date("2026-10-20T20:00:00Z"),
        status: "confirmed",
      });

      const res2 = canCreateAtomicHold({
        totalCapacity: 10,
        operationalBuffer: 2,
        requestedEntry: new Date("2026-10-20T10:00:00Z"),
        requestedExit: new Date("2026-10-20T18:00:00Z"),
        existingBookings,
        existingHolds: [],
        now,
      });
      // 8 is not < 8 -> rejected!
      expect(res2.canHold).toBe(false);
    });
  });

  describe("Zod Validation Schema (CreateBookingHoldSchema)", () => {
    const validFacilityId = "a0000000-0000-4000-a000-000000000001";
    const validServiceId = "a0000000-0000-4000-a000-000000000002";
    const validCustomerId = "a0000000-0000-4000-a000-000000000009";

    const validPayload = {
      facility_id: validFacilityId,
      service_id: validServiceId,
      entry_at: "2026-10-25T10:00:00Z",
      exit_at: "2026-10-28T10:00:00Z",
      guest_name: "Carlos Sanchez",
      guest_email: "carlos.sanchez@example.com",
      guest_phone: "+34612345678",
    };

    it("validates a compliant guest hold request", () => {
      const parsed = CreateBookingHoldSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it("rejects when exit is earlier than entry", () => {
      const parsed = CreateBookingHoldSchema.safeParse({
        ...validPayload,
        entry_at: "2026-10-28T10:00:00Z",
        exit_at: "2026-10-25T10:00:00Z",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path.includes("exit_at"));
        expect(issue?.message).toContain("posterior");
      }
    });

    it("rejects duration under 30 minutes", () => {
      const parsed = CreateBookingHoldSchema.safeParse({
        ...validPayload,
        entry_at: "2026-10-25T10:00:00Z",
        exit_at: "2026-10-25T10:15:00Z", // 15 mins
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path.includes("exit_at"));
        expect(issue?.message).toContain("30 minutos");
      }
    });

    it("rejects duration exceeding 90 days", () => {
      const parsed = CreateBookingHoldSchema.safeParse({
        ...validPayload,
        entry_at: "2026-10-25T10:00:00Z",
        exit_at: "2027-02-25T10:00:00Z", // > 90 days
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path.includes("exit_at"));
        expect(issue?.message).toContain("90 días");
      }
    });

    it("rejects when neither customer_id nor valid guest information is provided", () => {
      const parsed = CreateBookingHoldSchema.safeParse({
        facility_id: validFacilityId,
        service_id: validServiceId,
        entry_at: validPayload.entry_at,
        exit_at: validPayload.exit_at,
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts authenticated customer_id without guest details", () => {
      const parsed = CreateBookingHoldSchema.safeParse({
        facility_id: validFacilityId,
        service_id: validServiceId,
        entry_at: validPayload.entry_at,
        exit_at: validPayload.exit_at,
        customer_id: validCustomerId,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("Simulated Concurrent Holds Atomicity", () => {
    it("guarantees only one hold succeeds when 1 spot remains and 2 requests arrive concurrently", async () => {
      // Simulation of row-level lock & transaction serialization:
      // When 2 transactions compete for 1 remaining spot, the transactional mutex
      // forces sequential execution: Tx1 evaluates capacity, creates hold;
      // Tx2 evaluates capacity after Tx1 commits, sees peakOccupancy == sellable, and aborts.

      const activeHoldsDb: HoldInterval[] = [];
      const sellableCapacity = 1;

      // Atomic lock mutex simulating PostgreSQL `SELECT id FROM parking_facilities ... FOR UPDATE`
      let lockPromise: Promise<void> = Promise.resolve();

      const simulateRpcCall = async (callerId: string): Promise<{ success: boolean; callerId: string }> => {
        // Enqueue to mutex
        const currentLock = lockPromise;
        let releaseLock: () => void = () => {};
        lockPromise = new Promise((resolve) => {
          releaseLock = resolve;
        });

        await currentLock;
        try {
          // Inside transaction with facility locked FOR UPDATE
          const peak = computeTimelinePeakOccupancy({
            requestedEntry: new Date("2026-10-20T10:00:00Z"),
            requestedExit: new Date("2026-10-20T18:00:00Z"),
            existingBookings: [],
            existingHolds: activeHoldsDb,
            now,
          });

          if (peak >= sellableCapacity) {
            return { success: false, callerId };
          }

          // Atomic insert
          activeHoldsDb.push({
            entry: new Date("2026-10-20T10:00:00Z"),
            exit: new Date("2026-10-20T18:00:00Z"),
            status: "active",
            expiresAt: new Date("2026-10-19T10:15:00Z"),
          });

          return { success: true, callerId };
        } finally {
          releaseLock();
        }
      };

      // Run two competing calls concurrently
      const [resA, resB] = await Promise.all([
        simulateRpcCall("Client_Alpha"),
        simulateRpcCall("Client_Beta"),
      ]);

      const successCount = [resA, resB].filter((r) => r.success).length;
      const failureCount = [resA, resB].filter((r) => !r.success).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
      expect(activeHoldsDb.length).toBe(1);
    });
  });
});
