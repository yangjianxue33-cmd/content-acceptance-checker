import { schedules } from "@trigger.dev/sdk/v3";

import {
  deleteExpiredProductionReviews,
  type ReviewCleanupResult,
} from "@/server/reviews/delete-expired";
import {
  writeLogEvent,
  type ApprovedLogMetadata,
  type LogEventName,
} from "@/server/security/redact-log";

type DeleteExpiredReviewsRunDependencies = {
  cleanup: () => Promise<ReviewCleanupResult>;
  log: (event: LogEventName, metadata: ApprovedLogMetadata) => void;
  now?: () => number;
};

export function durationBand(milliseconds: number) {
  if (milliseconds < 1_000) return "under_1s" as const;
  if (milliseconds < 5_000) return "1s_to_5s" as const;
  if (milliseconds < 30_000) return "5s_to_30s" as const;
  return "over_30s" as const;
}

export function createDeleteExpiredReviewsRun(
  dependencies: DeleteExpiredReviewsRunDependencies,
) {
  return async function run(payload: unknown) {
    void payload;
    const currentTime = dependencies.now ?? Date.now;
    const startedAt = currentTime();
    try {
      const result = await dependencies.cleanup();
      dependencies.log("retention_cleanup_completed", {
        count: result.expiredReviewsDeleted + result.orphanObjectsDeleted,
        durationBand: durationBand(currentTime() - startedAt),
        outcome: result.failures === 0 ? "success" : "partial",
        reasonCode: result.failures === 0 ? "scheduled" : "storage_retry",
      });
      return result;
    } catch {
      dependencies.log("retention_cleanup_failed", {
        count: 0,
        durationBand: durationBand(currentTime() - startedAt),
        outcome: "failed",
        reasonCode: "unexpected_failure",
      });
      throw new Error("Retention cleanup failed");
    }
  };
}

const runCleanup = createDeleteExpiredReviewsRun({
  cleanup: deleteExpiredProductionReviews,
  log: writeLogEvent,
});

export const deleteExpiredReviewsTask = schedules.task({
  id: "delete-expired-reviews",
  cron: {
    pattern: "15 * * * *",
    timezone: "UTC",
    environments: ["STAGING", "PRODUCTION"],
  },
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  run: runCleanup,
});
