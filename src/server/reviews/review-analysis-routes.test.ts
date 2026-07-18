// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { createStartRouteHandler } from "@/app/api/reviews/[id]/start/route";
import { createStatusRouteHandler } from "@/app/api/reviews/[id]/status/route";
import { ReviewAnalysisAccessError } from "./review-analysis-access";

const reviewId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const accessToken = "anonymous-cookie-token";
const context = { params: Promise.resolve({ id: reviewId }) };

describe("POST /api/reviews/:id/start", () => {
  test("authenticates the cookie and enqueues only the review id", async () => {
    const start = vi.fn().mockResolvedValue({ status: "queued", shouldEnqueue: true });
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const POST = createStartRouteHandler({ start, enqueue });

    const response = await POST(
      new Request(`https://checker.example/api/reviews/${reviewId}/start`, {
        method: "POST",
        headers: { Cookie: `anonymous_review_access=${accessToken}` },
      }),
      context,
    );

    expect(start).toHaveBeenCalledWith({ reviewId, accessToken });
    expect(enqueue).toHaveBeenCalledWith({ reviewId });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ reviewId, status: "queued" });
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain(accessToken);
  });

  test("returns an idempotent report response without enqueueing completed work", async () => {
    const enqueue = vi.fn();
    const POST = createStartRouteHandler({
      start: vi.fn().mockResolvedValue({ status: "completed", shouldEnqueue: false }),
      enqueue,
    });

    const response = await POST(
      new Request(`https://checker.example/api/reviews/${reviewId}/start`, {
        method: "POST",
        headers: { Cookie: `anonymous_review_access=${accessToken}` },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reviewId,
      status: "completed",
      reportPath: `/review/report/${reviewId}`,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("maps missing, expired, deleted, and wrong-cookie reviews to one 404", async () => {
    const POST = createStartRouteHandler({
      start: vi.fn().mockRejectedValue(new ReviewAnalysisAccessError()),
      enqueue: vi.fn(),
    });

    const response = await POST(
      new Request(`https://checker.example/api/reviews/${reviewId}/start`, { method: "POST" }),
      context,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Review not found" });
  });
});

describe("GET /api/reviews/:id/status", () => {
  test("returns only safe aggregate and four-module progress fields", async () => {
    const load = vi.fn().mockResolvedValue({
      reviewId,
      status: "partial",
      terminal: true,
      reportReady: true,
      reportPath: `/review/report/${reviewId}`,
      modules: [
        { module: "brief_fit", label: "Brief fit", status: "complete", error: null },
        { module: "evidence_citations", label: "Evidence & citations", status: "unavailable", error: "Check temporarily unavailable." },
        { module: "editorial_quality", label: "Editorial quality", status: "complete", error: null },
        { module: "ai_risk", label: "AI-writing risk", status: "not_assessed", error: null },
      ],
    });
    const GET = createStatusRouteHandler({ load });

    const response = await GET(
      new Request(`https://checker.example/api/reviews/${reviewId}/status`, {
        headers: { Cookie: `anonymous_review_access=${accessToken}` },
      }),
      context,
    );

    expect(load).toHaveBeenCalledWith({ reviewId, accessToken });
    expect(await response.json()).toEqual(await load.mock.results[0].value);
    expect(JSON.stringify(await load.mock.results[0].value)).not.toMatch(
      /private|excerpt|probability|token|hash|provider/i,
    );
  });

  test("returns the same 404 for every access failure", async () => {
    const GET = createStatusRouteHandler({
      load: vi.fn().mockRejectedValue(new ReviewAnalysisAccessError()),
    });

    const response = await GET(
      new Request(`https://checker.example/api/reviews/${reviewId}/status`),
      context,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Review not found" });
  });
});
