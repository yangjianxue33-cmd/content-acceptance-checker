import { tasks } from "@trigger.dev/sdk/v3";

import {
  ReviewAnalysisAccessError,
  startProductionReviewAnalysis,
} from "@/server/reviews/review-analysis-access";
import type { analyzeReviewTask } from "@/trigger/analyze-review";

type RouteContext = { params: Promise<{ id: string }> };

function accessTokenFrom(request: Request) {
  const cookie = request.headers.get("cookie");
  const entry = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("anonymous_review_access="));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice("anonymous_review_access=".length)) || null;
  } catch {
    return null;
  }
}

async function enqueueProduction(payload: { reviewId: string }) {
  const { isFakeAnalysisEnabled } = await import(
    "@/server/security/fake-analysis-guard"
  );
  if (isFakeAnalysisEnabled()) {
    const [{ runProductionModules }, { finalizeProductionReview }] =
      await Promise.all([
        import("@/server/analysis/module-runner"),
        import("@/server/reviews/finalize-review"),
      ]);
    await runProductionModules(payload.reviewId);
    await finalizeProductionReview(payload.reviewId);
    return;
  }
  await tasks.trigger<typeof analyzeReviewTask>("analyze-review", payload, {
    idempotencyKey: `analysis:${payload.reviewId}`,
    idempotencyKeyTTL: "10s",
  });
}

type Dependencies = {
  start: typeof startProductionReviewAnalysis;
  enqueue: (payload: { reviewId: string }) => Promise<unknown>;
};

export function createStartRouteHandler(
  dependencies: Dependencies = {
    start: startProductionReviewAnalysis,
    enqueue: enqueueProduction,
  },
) {
  return async function POST(request: Request, context: RouteContext) {
    try {
      const { id: reviewId } = await context.params;
      const result = await dependencies.start({
        reviewId,
        accessToken: accessTokenFrom(request),
      });
      if (!result.shouldEnqueue) {
        return Response.json({
          reviewId,
          status: result.status,
          reportPath: `/report/${reviewId}`,
        });
      }
      await dependencies.enqueue({ reviewId });
      return Response.json(
        { reviewId, status: result.status },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof ReviewAnalysisAccessError) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json(
        { error: "Analysis could not be started. Try again." },
        { status: 503 },
      );
    }
  };
}

export const POST = createStartRouteHandler();
