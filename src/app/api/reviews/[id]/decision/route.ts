import { z } from "zod";

import {
  isUserDecision,
  ReviewDecisionAccessError,
  ReviewDecisionValidationError,
  setProductionReviewDecision,
} from "@/server/reviews/set-decision";

type RouteContext = { params: Promise<{ id: string }> };
const reviewIdSchema = z.uuid();

function accessTokenFrom(request: Request) {
  const cookie = request.headers.get("cookie");
  const entry = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("anonymous_review_access="));
  if (!entry) return null;
  try {
    return decodeURIComponent(
      entry.slice("anonymous_review_access=".length),
    ) || null;
  } catch {
    return null;
  }
}

export function createDecisionRouteHandler(
  dependencies: { set: typeof setProductionReviewDecision } = {
    set: setProductionReviewDecision,
  },
) {
  return async function PUT(request: Request, context: RouteContext) {
    try {
      const { id } = await context.params;
      const parsedReviewId = reviewIdSchema.safeParse(id);
      if (!parsedReviewId.success) {
        return Response.json({ error: "Invalid request." }, { status: 400 });
      }
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        throw new ReviewDecisionValidationError();
      }
      const decision =
        payload && typeof payload === "object" && "decision" in payload
          ? payload.decision
          : undefined;
      if (!isUserDecision(decision)) {
        throw new ReviewDecisionValidationError();
      }
      return Response.json(
        await dependencies.set({
          reviewId: parsedReviewId.data,
          accessToken: accessTokenFrom(request),
          decision,
        }),
      );
    } catch (error) {
      if (error instanceof ReviewDecisionValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof ReviewDecisionAccessError) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json(
        { error: "The editor decision could not be saved. Try again." },
        { status: 500 },
      );
    }
  };
}

export const PUT = createDecisionRouteHandler();
