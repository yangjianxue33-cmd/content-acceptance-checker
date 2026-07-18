import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ReviewProgress } from "./review-progress";

const reviewId = "cccccccc-1111-4111-8111-cccccccccccc";

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    reviewId,
    status: "reviewing",
    terminal: false,
    reportReady: false,
    reportPath: null,
    modules: [
      { module: "brief_fit", label: "Brief fit", status: "complete", error: null },
      { module: "evidence_citations", label: "Evidence & citations", status: "reviewing", error: null },
      { module: "editorial_quality", label: "Editorial quality", status: "queued", error: null },
      { module: "ai_risk", label: "AI-writing risk", status: "not_assessed", error: null },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReviewProgress", () => {
  test("starts idempotently and shows four independent module states", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse(statusPayload()));

    render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);

    expect(await screen.findByText("Evidence & citations")).toBeInTheDocument();
    expect(screen.getByText("Brief fit").closest("li")).toHaveTextContent("Complete");
    expect(screen.getByText("Evidence & citations").closest("li")).toHaveTextContent("Reviewing");
    expect(screen.getByText("Editorial quality").closest("li")).toHaveTextContent("Queued");
    expect(screen.getByText("AI-writing risk").closest("li")).toHaveTextContent("Not assessed");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/reviews/${reviewId}/start`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/reviews/${reviewId}/status`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("backs off polling and stops after a terminal response", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse(statusPayload()))
      .mockImplementationOnce(() =>
        jsonResponse(
          statusPayload({
            status: "completed",
            terminal: true,
            reportReady: true,
            reportPath: `/review/report/${reviewId}`,
            modules: statusPayload().modules.map((module) => ({ ...module, status: "complete" })),
          }),
        ),
      );

    render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("link", { name: "Open review report" })).toHaveAttribute(
      "href",
      `/review/report/${reviewId}`,
    );

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("cancels polling on unmount", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse(statusPayload()));
    const view = render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);
    await act(async () => {});
    view.unmount();

    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("stops polling when anonymous access is no longer valid", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse({ error: "Review not found" }, 404));

    render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");

    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("shows partial completion, advisory copy, and retries only unavailable work", async () => {
    const partial = statusPayload({
      status: "partial",
      terminal: true,
      reportReady: true,
      reportPath: `/review/report/${reviewId}`,
      modules: statusPayload().modules.map((module) =>
        module.module === "evidence_citations"
          ? { ...module, status: "unavailable", error: "Check temporarily unavailable." }
          : { ...module, status: "complete" },
      ),
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse(partial))
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "partial" }, 202))
      .mockImplementationOnce(() => jsonResponse(statusPayload()));

    render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);

    expect(await screen.findByText("Report ready with one unavailable check.")).toBeInTheDocument();
    expect(screen.getAllByText(/does not prove authorship/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry unavailable check" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/reviews/${reviewId}/start`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("offers retry for an overall failure", async () => {
    const failed = statusPayload({ status: "failed", terminal: true });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ reviewId, status: "queued" }, 202))
      .mockImplementationOnce(() => jsonResponse(failed));

    render(<ReviewProgress reviewId={reviewId} fetcher={fetcher} />);

    expect(await screen.findByRole("button", { name: "Retry analysis" })).toBeInTheDocument();
  });
});
