import { describe, it, expect } from "vitest";
import { searchParamsSchema } from "@/lib/schemas/search";

describe("searchParamsSchema Zod Validation", () => {
  const validAirportId = "a0000000-0000-4000-a000-000000000001";

  // Helper to generate dates relative to now
  const getFutureDate = (hoursAhead: number) => {
    return new Date(Date.now() + hoursAhead * 3600 * 1000).toISOString();
  };

  it("accepts valid search criteria", () => {
    const entry = getFutureDate(24); // 24 hours from now
    const exit = getFutureDate(96); // 4 days from now

    const result = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: entry,
      exit_at: exit,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.airport_id).toBe(validAirportId);
      expect(result.data.entry_at).toBe(entry);
      expect(result.data.exit_at).toBe(exit);
    }
  });

  it("rejects invalid airport UUIDs", () => {
    const result = searchParamsSchema.safeParse({
      airport_id: "not-a-uuid",
      entry_at: getFutureDate(24),
      exit_at: getFutureDate(48),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "airport_id");
      expect(issue).toBeDefined();
    }
  });

  it("rejects entry time in the past or less than 30 minutes from now", () => {
    // 10 minutes from now (< 30 min minimum)
    const resultNearFuture = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: getFutureDate(0.1),
      exit_at: getFutureDate(24),
    });
    expect(resultNearFuture.success).toBe(false);

    // 2 hours in the past
    const resultPast = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      exit_at: getFutureDate(24),
    });
    expect(resultPast.success).toBe(false);
  });

  it("rejects exit time that is before or equal to entry time", () => {
    const entry = getFutureDate(24);

    const resultEqual = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: entry,
      exit_at: entry,
    });
    expect(resultEqual.success).toBe(false);

    const resultBefore = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: entry,
      exit_at: getFutureDate(12), // exit earlier than entry
    });
    expect(resultBefore.success).toBe(false);
  });

  it("enforces minimum stay of 1 hour", () => {
    const entry = getFutureDate(24);
    // 30 minutes stay
    const exit = new Date(new Date(entry).getTime() + 30 * 60 * 1000).toISOString();

    const result = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: entry,
      exit_at: exit,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "exit_at");
      expect(issue?.message).toContain("Minimum stay is 1 hour");
    }
  });

  it("enforces maximum stay of 30 days", () => {
    const entry = getFutureDate(24);
    // 35 days stay
    const exit = new Date(new Date(entry).getTime() + 35 * 24 * 3600 * 1000).toISOString();

    const result = searchParamsSchema.safeParse({
      airport_id: validAirportId,
      entry_at: entry,
      exit_at: exit,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "exit_at");
      expect(issue?.message).toContain("Maximum stay is 30 days");
    }
  });
});
