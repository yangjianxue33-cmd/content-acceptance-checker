"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AnalysisModule, ModuleStatus } from "@/domain/analysis";

type ModuleProgress = {
  module: AnalysisModule;
  label: string;
  status: ModuleStatus;
  error: string | null;
};

type ProgressPayload = {
  reviewId: string;
  status: "queued" | "reviewing" | "completed" | "partial" | "failed";
  terminal: boolean;
  reportReady: boolean;
  reportPath: string | null;
  modules: ModuleProgress[];
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const STATUS_LABELS: Record<ModuleStatus, string> = {
  queued: "Queued",
  reviewing: "Reviewing",
  complete: "Complete",
  not_assessed: "Not assessed",
  unavailable: "Unavailable",
};

const INITIAL_MODULES: ModuleProgress[] = [
  { module: "brief_fit", label: "Brief fit", status: "queued", error: null },
  { module: "evidence_citations", label: "Evidence & citations", status: "queued", error: null },
  { module: "editorial_quality", label: "Editorial quality", status: "queued", error: null },
  { module: "ai_risk", label: "AI-writing risk", status: "queued", error: null },
];

export function ReviewProgress({
  reviewId,
  fetcher = globalThis.fetch,
}: {
  reviewId: string;
  fetcher?: Fetcher;
}) {
  const [progress, setProgress] = useState<ProgressPayload>({
    reviewId,
    status: "queued",
    terminal: false,
    reportReady: false,
    reportPath: null,
    modules: INITIAL_MODULES,
  });
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const delay = useRef(1_000);

  const clearPending = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const poll = useCallback(async function pollStatus(): Promise<void> {
    if (!active.current) return;
    controller.current = new AbortController();
    try {
      const response = await fetcher(`/api/reviews/${reviewId}/status`, {
        signal: controller.current.signal,
        cache: "no-store",
      });
      const payload = (await response.json()) as ProgressPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "status_failed");
      if (!active.current) return;
      setProgress(payload);
      setError(null);
      if (!payload.terminal) {
        const wait = delay.current;
        delay.current = Math.min(delay.current * 2, 8_000);
        timer.current = setTimeout(pollStatus, wait);
      }
    } catch (requestError) {
      if (!active.current || controller.current?.signal.aborted) return;
      const accessEnded =
        requestError instanceof Error &&
        requestError.message === "Review not found";
      setError(
        accessEnded
          ? "This review is no longer available."
          : "Progress could not be refreshed. Retrying…",
      );
      if (accessEnded) return;
      const wait = delay.current;
      delay.current = Math.min(delay.current * 2, 8_000);
      timer.current = setTimeout(pollStatus, wait);
    }
  }, [fetcher, reviewId]);

  const start = useCallback(async () => {
    clearPending();
    delay.current = 1_000;
    const response = await fetcher(`/api/reviews/${reviewId}/start`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "start_failed");
    }
    await poll();
  }, [clearPending, fetcher, poll, reviewId]);

  useEffect(() => {
    active.current = true;
    void start().catch((startError: unknown) => {
      if (!active.current) return;
      setError(
        startError instanceof Error && startError.message === "Review not found"
          ? "This review is no longer available."
          : "Analysis could not be started. Try again.",
      );
    });
    return () => {
      active.current = false;
      clearPending();
    };
  }, [clearPending, start]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setError(null);
    setProgress((current) => ({ ...current, terminal: false, reportReady: false }));
    try {
      await start();
    } catch {
      setError("Analysis could not be restarted. Try again.");
    } finally {
      if (active.current) setRetrying(false);
    }
  }

  const unavailableCount = progress.modules.filter(
    (module) => module.status === "unavailable",
  ).length;
  const canRetry = progress.status === "failed" || unavailableCount > 0;
  const headline =
    progress.status === "completed"
      ? "All checks complete."
      : progress.status === "partial"
        ? `Report ready with ${unavailableCount === 1 ? "one unavailable check" : `${unavailableCount} unavailable checks`}.`
        : progress.status === "failed"
          ? "Analysis needs another attempt."
          : "Four checks are moving independently.";

  return (
    <section className="progress-board" aria-labelledby="progress-title">
      <header className="progress-heading">
        <div>
          <p className="section-label">Live acceptance scan</p>
          <h1 id="progress-title">{headline}</h1>
        </div>
        <p role="status" aria-live="polite">
          {progress.terminal
            ? "Analysis reached a terminal state."
            : "You can leave this page; the review continues in the background."}
        </p>
      </header>

      {error ? <p className="progress-error" role="alert">{error}</p> : null}

      <ol className="module-track" aria-label="Analysis module progress">
        {progress.modules.map((module, index) => (
          <li key={module.module} data-status={module.status}>
            <span className="module-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{module.label}</strong>
              {module.error ? <small>{module.error}</small> : null}
            </div>
            <span className="module-status">{STATUS_LABELS[module.status]}</span>
          </li>
        ))}
      </ol>

      <footer className="progress-footer">
        <p>
          <strong>Advisory signal:</strong> AI-writing risk does not prove
          authorship and never decides acceptance on its own.
        </p>
        <div className="progress-actions">
          {canRetry ? (
            <button type="button" onClick={retry} disabled={retrying}>
              {retrying
                ? "Restarting…"
                : progress.status === "failed"
                  ? "Retry analysis"
                  : unavailableCount === 1
                    ? "Retry unavailable check"
                    : "Retry unavailable checks"}
            </button>
          ) : null}
          {progress.reportReady && progress.reportPath ? (
            <Link href={progress.reportPath}>Open review report</Link>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
