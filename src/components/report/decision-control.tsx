"use client";

import { useState } from "react";

import type { PublicReviewReport } from "@/server/reviews/get-report";

type RecordedDecision = NonNullable<PublicReviewReport["decision"]>;
type UserDecision = RecordedDecision["value"];
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OPTIONS: ReadonlyArray<{
  value: UserDecision;
  label: string;
  description: string;
}> = [
  {
    value: "ready",
    label: "Ready",
    description: "The editor considers this content ready for the next approval step.",
  },
  {
    value: "revisions_requested",
    label: "Revisions requested",
    description: "The editor wants changes before the content advances.",
  },
  {
    value: "manually_reviewed",
    label: "Manually reviewed",
    description: "The editor completed the required contextual review.",
  },
];

export function DecisionControl({
  reviewId,
  initialDecision,
  fetcher = globalThis.fetch,
}: {
  reviewId: string;
  initialDecision: RecordedDecision | null;
  fetcher?: Fetcher;
}) {
  const [selected, setSelected] = useState<UserDecision | null>(
    initialDecision?.value ?? null,
  );
  const [recorded, setRecorded] = useState(initialDecision);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveDecision() {
    if (!selected || saving) return;
    setSaving(true);
    setMessage("Saving editor decision…");
    setError(null);
    try {
      const response = await fetcher(`/api/reviews/${reviewId}/decision`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ decision: selected }),
      });
      if (!response.ok) throw new Error("decision_save_failed");
      const payload = (await response.json()) as {
        decision: UserDecision;
        recordedAt: string;
      };
      setRecorded({ value: payload.decision, recordedAt: payload.recordedAt });
      setMessage("Editor decision saved.");
    } catch {
      setMessage(null);
      setError("The editor decision could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="decision-panel" aria-labelledby="decision-title">
      <div className="report-section-heading">
        <div>
          <p className="section-label">Human checkpoint</p>
          <h2 id="decision-title">Editor&apos;s recorded decision</h2>
        </div>
        <span>Independent of the system recommendation</span>
      </div>

      <fieldset disabled={saving}>
        <legend className="visually-hidden">Editor&apos;s recorded decision</legend>
        <div className="decision-options">
          {OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="editor-decision"
                value={option.value}
                aria-label={option.label}
                aria-describedby={`decision-${option.value}-description`}
                checked={selected === option.value}
                onChange={() => {
                  setSelected(option.value);
                  setMessage(null);
                  setError(null);
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <small id={`decision-${option.value}-description`}>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="decision-save-row">
        <p>
          {recorded ? (
            <>
              Last recorded by the server: <time dateTime={recorded.recordedAt}>{recorded.recordedAt}</time>
            </>
          ) : (
            "No editor decision has been recorded."
          )}
        </p>
        <button type="button" onClick={saveDecision} disabled={!selected || saving}>
          {saving ? "Saving…" : "Save editor decision"}
        </button>
      </div>
      {message ? <p className="decision-message" role="status" aria-live="polite">{message}</p> : null}
      {error ? <p className="decision-error" role="alert">{error}</p> : null}
    </section>
  );
}
