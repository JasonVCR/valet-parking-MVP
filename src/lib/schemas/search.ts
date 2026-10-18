/**
 * Zod schemas for search input validation.
 *
 * These schemas validate user-facing inputs before they reach any server query.
 * They do NOT compute prices or availability — that is always done server-side.
 */

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimum advance booking: at least 30 minutes from now. */
const MIN_ADVANCE_MS = 30 * 60 * 1_000;

/** Maximum booking window: 1 year from now (operational limit). */
const MAX_ADVANCE_MS = 365 * 24 * 60 * 60 * 1_000;

/**
 * Maximum stay duration: 30 days.
 * This is a client-side guard; the server also validates.
 */
const MAX_STAY_MS = 30 * 24 * 60 * 60 * 1_000;

/** Minimum stay duration: 1 hour. */
const MIN_STAY_MS = 60 * 60 * 1_000;

// ─── Date-time refinements ────────────────────────────────────────────────────

const isoDatetime = z
  .string()
  .datetime({ message: "Must be a valid ISO-8601 datetime string" });

// ─── Search schema ────────────────────────────────────────────────────────────

export const searchParamsSchema = z
  .object({
    airport_id: z.string().uuid({ message: "Invalid airport selection" }),
    entry_at: isoDatetime,
    exit_at: isoDatetime,
  })
  .superRefine((data, ctx) => {
    const now = Date.now();
    const entry = new Date(data.entry_at).getTime();
    const exit = new Date(data.exit_at).getTime();

    if (isNaN(entry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_at"],
        message: "Invalid entry date",
      });
      return;
    }
    if (isNaN(exit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "Invalid exit date",
      });
      return;
    }

    if (entry <= now + MIN_ADVANCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_at"],
        message: "Entry must be at least 30 minutes in the future",
      });
    }

    if (entry >= now + MAX_ADVANCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_at"],
        message: "Entry cannot be more than 1 year in the future",
      });
    }

    if (exit <= entry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "Exit must be after entry",
      });
      return;
    }

    const stayMs = exit - entry;
    if (stayMs < MIN_STAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "Minimum stay is 1 hour",
      });
    }

    if (stayMs > MAX_STAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exit_at"],
        message: "Maximum stay is 30 days",
      });
    }
  });

export type SearchParamsInput = z.infer<typeof searchParamsSchema>;

// ─── Airport selector schema ──────────────────────────────────────────────────

export const airportSelectorSchema = z.object({
  query: z.string().min(1).max(100),
});
