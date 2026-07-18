// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { finalizeReview } from "./finalize-review";

const reviewId = "88888888-8888-4888-8888-888888888888";

function moduleRow(
  module: "brief_fit" | "evidence_citations" | "editorial_quality" | "ai_risk",
  options: Record<string, unknown> = {},
) {
  return {
    module,
    status: "complete" as const,
    aiRisk: module === "ai_risk" ? "low" as const : null,
    issues: [],
    ...options,
  };
}

function repository(rows: ReturnType<typeof moduleRow>[]) {
  const persist = vi.fn().mockResolvedValue(undefined);
  return {
    persist,
    repository: {
      loadModules: vi.fn().mockResolvedValue(rows),
      persistFinalization: persist,
    },
  };
}

describe("finalizeReview", () => {
  test("normalizes score weights and completes after all four modules finish", async () => {
    const setup = repository([
      moduleRow("brief_fit", { issues: [{ id: "1", module: "brief_fit", severity: "major" }] }),
      moduleRow("evidence_citations"),
      moduleRow("editorial_quality"),
      moduleRow("ai_risk", { aiRisk: "medium" }),
    ]);

    await expect(finalizeReview(reviewId, setup.repository)).resolves.toEqual({
      status: "completed",
      overallScore: 91,
      systemRecommendation: "request_revisions",
    });
    expect(setup.persist).toHaveBeenCalledWith(reviewId, {
      status: "completed",
      overallScore: 91,
      systemRecommendation: "request_revisions",
    });
  });

  test("produces a stable partial state and renormalized score when one module is unavailable", async () => {
    const setup = repository([
      moduleRow("brief_fit"),
      moduleRow("evidence_citations", { status: "unavailable", aiRisk: null }),
      moduleRow("editorial_quality", { issues: [{ id: "2", module: "editorial_quality", severity: "major" }] }),
      moduleRow("ai_risk", { aiRisk: "high" }),
    ]);

    await expect(finalizeReview(reviewId, setup.repository)).resolves.toEqual({
      status: "partial",
      overallScore: 81,
      systemRecommendation: "manual_review_required",
    });
  });

  test("fails safely with fewer than two completed modules", async () => {
    const setup = repository([
      moduleRow("brief_fit"),
      moduleRow("evidence_citations", { status: "unavailable" }),
      moduleRow("editorial_quality", { status: "unavailable" }),
      moduleRow("ai_risk", { status: "not_assessed", aiRisk: "not_assessed" }),
    ]);

    await expect(finalizeReview(reviewId, setup.repository)).resolves.toEqual({
      status: "failed",
      overallScore: null,
      systemRecommendation: "manual_review_required",
    });
  });

  test("does not finalize while a module remains nonterminal", async () => {
    const setup = repository([
      moduleRow("brief_fit"),
      moduleRow("evidence_citations"),
      moduleRow("editorial_quality", { status: "reviewing" }),
      moduleRow("ai_risk"),
    ]);

    await expect(finalizeReview(reviewId, setup.repository)).resolves.toBeNull();
    expect(setup.persist).not.toHaveBeenCalled();
  });
});
