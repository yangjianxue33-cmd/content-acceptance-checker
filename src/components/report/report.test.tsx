import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { PublicReviewReport } from "@/server/reviews/get-report";
import { DecisionControl } from "./decision-control";
import { IssueList } from "./issue-list";
import { ModuleCard } from "./module-card";
import { ReportSummary } from "./report-summary";

const reviewId = "77777777-7777-4777-8777-777777777777";
const disclaimer =
  "Results are advisory, do not prove authorship or misconduct, and final approval stays with the editor.";

function report(overrides: Partial<PublicReviewReport> = {}): PublicReviewReport {
  return {
    title: "Launch article acceptance pass",
    contentType: "thought_leadership",
    wordCount: 1280,
    status: "completed",
    score: 86,
    recommendation: "request_revisions",
    modules: [
      {
        module: "brief_fit",
        label: "Brief fit",
        status: "complete",
        score: 91,
        aiRisk: null,
        summary: "The article covers the confirmed launch brief.",
        caveats: [],
      },
      {
        module: "evidence_citations",
        label: "Evidence & citations",
        status: "unavailable",
        score: null,
        aiRisk: null,
        summary: null,
        caveats: ["Check temporarily unavailable."],
      },
      {
        module: "editorial_quality",
        label: "Editorial quality",
        status: "complete",
        score: 94,
        aiRisk: null,
        summary: "The copy is clear and consistent.",
        caveats: [],
      },
      {
        module: "ai_risk",
        label: "AI-writing risk",
        status: "not_assessed",
        score: null,
        aiRisk: "not_assessed",
        summary: "AI-writing risk was not assessed.",
        caveats: [],
      },
    ],
    requirements: [
      {
        category: "Audience",
        text: "Address agency operations leaders.",
        critical: true,
        evaluation: "met",
      },
      {
        category: "Evidence",
        text: "Support adoption claims with primary research.",
        critical: false,
        evaluation: "partial",
      },
    ],
    issues: [
      {
        module: "brief_fit",
        severity: "critical",
        sourceExcerpt: "For individual creators, the workflow is simple.",
        explanation: "The confirmed audience is agency operations leaders.",
        suggestedAction: "Refocus the opening on agency operations.",
      },
      {
        module: "editorial_quality",
        severity: "major",
        sourceExcerpt: "This is why it matters. It is also important.",
        explanation: "The transition does not connect the two claims.",
        suggestedAction: "State the relationship directly.",
      },
      {
        module: "brief_fit",
        severity: "minor",
        sourceExcerpt: null,
        explanation: "One supporting detail is repeated.",
        suggestedAction: "Remove the repeated detail.",
      },
    ],
    decision: {
      value: "revisions_requested",
      recordedAt: "2026-07-19T12:01:00.000Z",
    },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("actionable report UI", () => {
  test("separates normalized score and system recommendation and shows confirmed requirements", () => {
    render(<ReportSummary report={report()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Launch article acceptance pass" }),
    ).toBeInTheDocument();
    const score = screen.getByRole("region", { name: "Normalized score" });
    const recommendation = screen.getByRole("region", {
      name: "System recommendation",
    });
    expect(score).toHaveTextContent("86 / 100");
    expect(score).not.toHaveTextContent("Request revisions");
    expect(recommendation).toHaveTextContent("Request revisions");
    expect(recommendation).not.toHaveTextContent("86 / 100");
    expect(screen.getByText("Address agency operations leaders.")).toBeInTheDocument();
    expect(screen.getByText("Met")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText(disclaimer)).toBeInTheDocument();
  });

  test("renders a failed no-score state without manufacturing a recommendation", () => {
    render(
      <ReportSummary
        report={report({
          status: "failed",
          score: null,
          recommendation: null,
        })}
      />,
    );

    expect(screen.getByRole("region", { name: "Normalized score" })).toHaveTextContent(
      "Not available",
    );
    expect(
      screen.getByRole("region", { name: "System recommendation" }),
    ).toHaveTextContent("Not available");
    expect(screen.getByText(/return to progress and retry the analysis/i)).toBeInTheDocument();
  });

  test("labels unavailable and not-assessed modules without relying on color", () => {
    const current = report();
    const { rerender } = render(<ModuleCard module={current.modules[1]} index={1} />);

    expect(screen.getByRole("heading", { name: "Evidence & citations" })).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Check temporarily unavailable.")).toBeInTheDocument();

    rerender(<ModuleCard module={current.modules[3]} index={3} />);
    expect(screen.getAllByText("Not assessed")).toHaveLength(2);
    expect(screen.getByText("AI-writing risk was not assessed.")).toBeInTheDocument();
  });

  test("groups issues by severity and renders bounded source excerpts as read-only context", () => {
    render(<IssueList issues={report().issues} />);

    const groups = screen.getAllByRole("heading", { level: 3 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      "Critical",
      "Major",
      "Minor",
    ]);
    const criticalGroup = screen.getByRole("region", { name: "Critical issues" });
    expect(within(criticalGroup).getByText("Brief fit")).toBeInTheDocument();
    expect(within(criticalGroup).getByText("Read-only source context")).toBeInTheDocument();
    expect(
      within(criticalGroup).getByText("For individual creators, the workflow is simple."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });

  test("uses manual-review wording only for high AI-writing risk", () => {
    render(
      <ModuleCard
        index={3}
        module={{
          module: "ai_risk",
          label: "AI-writing risk",
          status: "complete",
          score: 40,
          aiRisk: "high",
          summary:
            "AI-writing-risk signals are high. Manual review is required; this does not prove authorship or misconduct.",
          caveats: [],
        }}
      />,
    );

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(/manual review/i);
    expect(card).not.toHaveTextContent(/reject|cheating|proof of authorship/i);
  });

  test("keeps the editor decision separate and saves a keyboard-selected exact value", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        decision: "manually_reviewed",
        recordedAt: "2026-07-19T12:03:00.000Z",
      }),
    );
    render(
      <DecisionControl
        reviewId={reviewId}
        initialDecision={report().decision}
        fetcher={fetcher}
      />,
    );
    const manuallyReviewed = screen.getByRole("radio", {
      name: "Manually reviewed",
    });
    manuallyReviewed.focus();
    await user.keyboard("[Space]");
    await user.click(screen.getByRole("button", { name: "Save editor decision" }));

    expect(fetcher).toHaveBeenCalledWith(
      `/api/reviews/${reviewId}/decision`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ decision: "manually_reviewed" }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Editor decision saved.",
    );
    expect(screen.getByRole("group", { name: "Editor's recorded decision" })).not.toHaveTextContent(
      "System recommendation",
    );
  });

  test("announces a generic decision save error", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        { error: "The editor decision could not be saved. Try again." },
        { status: 500 },
      ),
    );
    render(
      <DecisionControl reviewId={reviewId} initialDecision={null} fetcher={fetcher} />,
    );

    await user.click(screen.getByRole("radio", { name: "Ready" }));
    await user.click(screen.getByRole("button", { name: "Save editor decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The editor decision could not be saved. Try again.",
    );
  });
});
