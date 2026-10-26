import { describe, it, expect } from "vitest";
import {
  computeSha256,
  PLATFORM_TERMS_DOCUMENT,
  PRIVACY_POLICY_DOCUMENT,
  CANCELLATION_POLICY_DOCUMENT,
  DEFAULT_CANCELLATION_RULE,
  evaluateCancellationRefund,
} from "@/data/legalDocuments";

describe("Legal Documents & Terms Versioning (src/data/legalDocuments.ts)", () => {
  describe("Cryptographic SHA-256 Hashing & Integrity", () => {
    it("computes reproducible and valid 64-character hex SHA-256 hashes", () => {
      const hash1 = computeSha256(PLATFORM_TERMS_DOCUMENT.content_markdown);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).toBe(PLATFORM_TERMS_DOCUMENT.sha256_hash);
    });

    it("detects any modification in document content", () => {
      const originalHash = PLATFORM_TERMS_DOCUMENT.sha256_hash;
      const tamperedContent = PLATFORM_TERMS_DOCUMENT.content_markdown + "\n<!-- unauthorized edit -->";
      const tamperedHash = computeSha256(tamperedContent);

      expect(tamperedHash).not.toBe(originalHash);
    });

    it("verifies privacy policy and cancellation policy document hashes match", () => {
      expect(computeSha256(PRIVACY_POLICY_DOCUMENT.content_markdown)).toBe(
        PRIVACY_POLICY_DOCUMENT.sha256_hash
      );
      expect(computeSha256(CANCELLATION_POLICY_DOCUMENT.content_markdown)).toBe(
        CANCELLATION_POLICY_DOCUMENT.sha256_hash
      );
    });
  });

  describe("Cancellation Policy Rules & Refund Calculation", () => {
    const entryAt = "2026-11-05T12:00:00Z";
    const totalPaid = 6000; // 60.00 EUR in minor units

    it("grants 100% refund when cancelling > 24 hours in advance", () => {
      // Cancelling 48 hours before entry
      const cancelAt = "2026-11-03T12:00:00Z";
      const result = evaluateCancellationRefund(
        DEFAULT_CANCELLATION_RULE,
        entryAt,
        cancelAt,
        totalPaid
      );

      expect(result.isFreeCancellation).toBe(true);
      expect(result.refundAmount).toBe(6000);
      expect(result.penaltyAmount).toBe(0);
    });

    it("grants 100% refund exactly at the 24 hours boundary", () => {
      // Exactly 24 hours before
      const cancelAt = "2026-11-04T12:00:00Z";
      const result = evaluateCancellationRefund(
        DEFAULT_CANCELLATION_RULE,
        entryAt,
        cancelAt,
        totalPaid
      );

      expect(result.isFreeCancellation).toBe(true);
      expect(result.refundAmount).toBe(6000);
      expect(result.penaltyAmount).toBe(0);
    });

    it("applies late cancellation penalty (50%) when cancelling under 24 hours", () => {
      // Cancelling 6 hours before entry
      const cancelAt = "2026-11-05T06:00:00Z";
      const result = evaluateCancellationRefund(
        DEFAULT_CANCELLATION_RULE,
        entryAt,
        cancelAt,
        totalPaid
      );

      expect(result.isFreeCancellation).toBe(false);
      expect(result.penaltyAmount).toBe(3000); // 50% of 6000 = 3000
      expect(result.refundAmount).toBe(3000);
    });

    it("applies 100% penalty for no-show when cancelling after entry time", () => {
      // Cancelling 2 hours after entry time
      const cancelAt = "2026-11-05T14:00:00Z";
      const result = evaluateCancellationRefund(
        DEFAULT_CANCELLATION_RULE,
        entryAt,
        cancelAt,
        totalPaid
      );

      expect(result.isFreeCancellation).toBe(false);
      expect(result.penaltyAmount).toBe(6000); // 100% of 6000
      expect(result.refundAmount).toBe(0);
    });
  });
});
