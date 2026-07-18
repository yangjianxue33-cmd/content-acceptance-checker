import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { runProductionModules } from "@/server/analysis/module-runner";
import { finalizeProductionReview } from "@/server/reviews/finalize-review";

const payloadSchema = z.strictObject({ reviewId: z.uuid() });

type AnalyzeReviewDependencies = {
  runModules: (reviewId: string) => Promise<unknown>;
  finalize: (reviewId: string) => Promise<unknown>;
};

export function createAnalyzeReviewRun(dependencies: AnalyzeReviewDependencies) {
  return async function run(payload: unknown) {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Invalid analysis task payload");
    await dependencies.runModules(parsed.data.reviewId);
    return dependencies.finalize(parsed.data.reviewId);
  };
}

const runAnalysis = createAnalyzeReviewRun({
  runModules: runProductionModules,
  finalize: finalizeProductionReview,
});

export const analyzeReviewTask = task({
  id: "analyze-review",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  maxDuration: 300,
  run: runAnalysis,
});
