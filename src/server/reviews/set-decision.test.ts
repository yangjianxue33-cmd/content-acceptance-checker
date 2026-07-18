// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { createDecisionRouteHandler } from "@/app/api/reviews/[id]/decision/route";
import { hashAccessToken } from "@/server/security/token";
import {
  ReviewDecisionAccessError,
  ReviewDecisionValidationError,
  setReviewDecision,
  type DecisionRepository,
} from "./set-decision";

const reviewId = "77777777-7777-4777-8777-777777777777";
const accessToken = "anonymous-cookie-token";
const tokenHashSecret = "test-token-hash-secret";

function repository(): DecisionRepository {
  return {
    setDecision: vi.fn().mockResolvedValue("2026-07-19T12:01:00.000Z"),
  };
}

describe("setReviewDecision", () => {
  test.each(["ready", "revisions_requested", "manually_reviewed"] as const)(
    "accepts and records the %s decision through the atomic repository boundary",
    async (decision) => {
      const repo = repository();

      await expect(
        setReviewDecision(
          { reviewId, accessToken, tokenHashSecret, decision },
          repo,
        ),
      ).resolves.toEqual({
        decision,
        recordedAt: "2026-07-19T12:01:00.000Z",
      });
      expect(repo.setDecision).toHaveBeenCalledWith({
        reviewId,
        accessTokenHash: hashAccessToken(accessToken, tokenHashSecret),
        decision,
      });
    },
  );

  test("rejects missing ownership without invoking the mutation", async () => {
    const repo = repository();

    await expect(
      setReviewDecision(
        { reviewId, accessToken: null, tokenHashSecret, decision: "ready" },
        repo,
      ),
    ).rejects.toBeInstanceOf(ReviewDecisionAccessError);
    expect(repo.setDecision).not.toHaveBeenCalled();
  });

  test("preserves the generic access error from an atomic ownership or expiry failure", async () => {
    const repo = repository();
    vi.mocked(repo.setDecision).mockRejectedValue(new ReviewDecisionAccessError());

    await expect(
      setReviewDecision(
        { reviewId, accessToken, tokenHashSecret, decision: "ready" },
        repo,
      ),
    ).rejects.toBeInstanceOf(ReviewDecisionAccessError);
  });

  test("rejects values outside the exact three-value decision contract", async () => {
    const repo = repository();

    await expect(
      setReviewDecision(
        {
          reviewId,
          accessToken,
          tokenHashSecret,
          decision: "approved" as "ready",
        },
        repo,
      ),
    ).rejects.toBeInstanceOf(ReviewDecisionValidationError);
    expect(repo.setDecision).not.toHaveBeenCalled();
  });

  test("returns the unchanged server timestamp when a repeated submission is idempotent", async () => {
    const repo = repository();
    vi.mocked(repo.setDecision).mockResolvedValue("2026-07-19T12:01:00.000Z");

    const first = await setReviewDecision(
      { reviewId, accessToken, tokenHashSecret, decision: "ready" },
      repo,
    );
    const repeated = await setReviewDecision(
      { reviewId, accessToken, tokenHashSecret, decision: "ready" },
      repo,
    );

    expect(repeated).toEqual(first);
  });
});

describe("PUT /api/reviews/:id/decision", () => {
  const context = { params: Promise.resolve({ id: reviewId }) };

  function request(body: unknown, cookie = accessToken) {
    return new Request(
      `https://checker.example/api/reviews/${reviewId}/decision`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(cookie
            ? { Cookie: `anonymous_review_access=${encodeURIComponent(cookie)}` }
            : {}),
        },
        body: JSON.stringify(body),
      },
    );
  }

  test("reads the HMAC-bound cookie server-side and returns only the recorded decision", async () => {
    const set = vi.fn().mockResolvedValue({
      decision: "manually_reviewed",
      recordedAt: "2026-07-19T12:01:00.000Z",
    });
    const PUT = createDecisionRouteHandler({ set });

    const response = await PUT(
      request({ decision: "manually_reviewed" }),
      context,
    );

    expect(set).toHaveBeenCalledWith({
      reviewId,
      accessToken,
      decision: "manually_reviewed",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decision: "manually_reviewed",
      recordedAt: "2026-07-19T12:01:00.000Z",
    });
  });

  test.each([
    ["unknown value", { decision: "approved" }],
    ["missing value", {}],
    ["non-string value", { decision: 1 }],
  ])("returns 400 for %s without mutating", async (_label, body) => {
    const set = vi.fn();
    const PUT = createDecisionRouteHandler({ set });

    const response = await PUT(request(body), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a valid editor decision.",
    });
    expect(set).not.toHaveBeenCalled();
  });

  test("returns 400 for malformed JSON", async () => {
    const set = vi.fn();
    const PUT = createDecisionRouteHandler({ set });
    const malformed = new Request(
      `https://checker.example/api/reviews/${reviewId}/decision`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `anonymous_review_access=${accessToken}`,
        },
        body: "{",
      },
    );

    const response = await PUT(malformed, context);

    expect(response.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  test("uses the same generic 404 for missing, wrong, or expired access", async () => {
    const PUT = createDecisionRouteHandler({
      set: vi.fn().mockRejectedValue(new ReviewDecisionAccessError()),
    });

    const response = await PUT(request({ decision: "ready" }, ""), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Review not found" });
  });

  test("returns a generic 500 without infrastructure detail", async () => {
    const PUT = createDecisionRouteHandler({
      set: vi.fn().mockRejectedValue(new Error("private database detail")),
    });

    const response = await PUT(request({ decision: "ready" }), context);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "The editor decision could not be saved. Try again.",
    });
  });
});
