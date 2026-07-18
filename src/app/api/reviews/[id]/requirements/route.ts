import {
  confirmProductionRequirements,
  loadProductionRequirements,
  RequirementsAccessError,
  RequirementsLoadError,
  RequirementsValidationError,
} from "@/server/reviews/confirm-requirements";

type AccessInput = {
  reviewId: string;
  accessToken: string | null;
};

type RouteDependencies = {
  load: typeof loadProductionRequirements;
  confirm: typeof confirmProductionRequirements;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

function accessTokenFrom(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("anonymous_review_access="));
  if (!entry) return null;
  const value = entry.slice("anonymous_review_access=".length);
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof RequirementsAccessError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RequirementsValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RequirementsLoadError) {
    return Response.json(
      { error: "Requirements could not be loaded" },
      { status: 502 },
    );
  }
  return Response.json(
    { error: "Requirements could not be loaded" },
    { status: 500 },
  );
}

export function createRequirementsRouteHandlers(
  dependencies: RouteDependencies = {
    load: loadProductionRequirements,
    confirm: confirmProductionRequirements,
  },
) {
  return {
    async GET(request: Request, context: RouteContext) {
      try {
        const { id: reviewId } = await context.params;
        const input: AccessInput = {
          reviewId,
          accessToken: accessTokenFrom(request),
        };
        const result = await dependencies.load(input);
        if (result.kind === "redirect") {
          return Response.json({ nextPath: result.nextPath });
        }
        return Response.json({
          reviewId: result.reviewId,
          requirements: result.requirements,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async PUT(request: Request, context: RouteContext) {
      try {
        const { id: reviewId } = await context.params;
        const body: unknown = await request.json();
        const requirements =
          body && typeof body === "object" && "requirements" in body
            ? body.requirements
            : undefined;
        const result = await dependencies.confirm({
          reviewId,
          accessToken: accessTokenFrom(request),
          requirements,
        });
        return Response.json(result);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return Response.json(
            { error: "Check each requirement and try again." },
            { status: 400 },
          );
        }
        return errorResponse(error);
      }
    },
  };
}

export const { GET, PUT } = createRequirementsRouteHandlers();
