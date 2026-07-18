import {
  loadProductionReviewStatus,
  ReviewAnalysisAccessError,
} from "@/server/reviews/review-analysis-access";

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

export function createStatusRouteHandler(
  dependencies: { load: typeof loadProductionReviewStatus } = {
    load: loadProductionReviewStatus,
  },
) {
  return async function GET(request: Request, context: RouteContext) {
    try {
      const { id: reviewId } = await context.params;
      return Response.json(
        await dependencies.load({
          reviewId,
          accessToken: accessTokenFrom(request),
        }),
      );
    } catch (error) {
      if (error instanceof ReviewAnalysisAccessError) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json(
        { error: "Review status is temporarily unavailable." },
        { status: 503 },
      );
    }
  };
}

export const GET = createStatusRouteHandler();
