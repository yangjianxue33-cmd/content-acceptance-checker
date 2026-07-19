import { describe, expect, it, vi } from "vitest";

import {
  createDeleteExpiredReviewsRun,
  durationBand,
} from "@/trigger/delete-expired-reviews";

describe("delete expired reviews task", () => {
  it("is import-safe without credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    await expect(import("@/trigger/delete-expired-reviews")).resolves.toBeDefined();
  });

  it("logs only aggregate cleanup metadata", async () => {
    const cleanup = vi.fn().mockResolvedValue({
      expiredReviewsDeleted: 2,
      expiredObjectsDeleted: 3,
      orphanObjectsDeleted: 1,
      failures: 1,
    });
    const log = vi.fn();
    const run = createDeleteExpiredReviewsRun({ cleanup, log });

    const result = await run({ timestamp: new Date(), timezone: "UTC" } as never);

    expect(result.expiredReviewsDeleted).toBe(2);
    expect(log).toHaveBeenCalledWith("retention_cleanup_completed", {
      count: 3,
      durationBand: expect.any(String),
      outcome: "partial",
      reasonCode: "storage_retry",
    });
  });

  it("emits a bounded reason code and rethrows a generic task error", async () => {
    const secret = "provider-payload-secret";
    const log = vi.fn();
    const run = createDeleteExpiredReviewsRun({
      cleanup: vi.fn().mockRejectedValue(new Error(secret)),
      log,
    });

    await expect(run({} as never)).rejects.toThrow("Retention cleanup failed");
    expect(log).toHaveBeenCalledWith("retention_cleanup_failed", {
      count: 0,
      durationBand: expect.any(String),
      outcome: "failed",
      reasonCode: "unexpected_failure",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it.each([
    [999, "under_1s"],
    [1_000, "1s_to_5s"],
    [5_000, "5s_to_30s"],
    [30_000, "over_30s"],
  ] as const)("maps %dms to %s", (milliseconds, expected) => {
    expect(durationBand(milliseconds)).toBe(expected);
  });
});
