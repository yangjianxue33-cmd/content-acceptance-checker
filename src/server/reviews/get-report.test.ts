// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest";

import { hashAccessToken } from "@/server/security/token";
import {
  getReviewReport,
  ReviewReportAccessError,
  type ReportRepository,
} from "./get-report";

const reviewId = "77777777-7777-4777-8777-777777777777";
const accessToken = "anonymous-cookie-token";
const tokenHashSecret = "test-token-hash-secret";
const now = new Date("2026-07-19T12:00:00.000Z");

function review(overrides: Record<string, unknown> = {}) {
  return {
    anonymousAccessTokenHash: hashAccessToken(accessToken, tokenHashSecret),
    deleteAt: "2026-07-20T12:00:00.000Z",
    title: "Launch article acceptance pass",
    contentType: "thought_leadership" as const,
    wordCount: 1280,
    status: "completed" as const,
    overallScore: 86,
    systemRecommendation: "request_revisions" as const,
    ...overrides,
  };
}

function modules() {
  return [
    {
      module: "brief_fit" as const,
      status: "complete" as const,
      score: 91,
      aiRisk: null,
      summary: "The article covers the confirmed launch brief.",
      caveats: [],
    },
    {
      module: "evidence_citations" as const,
      status: "complete" as const,
      score: 72,
      aiRisk: null,
      summary: "One material claim needs a stronger source.",
      caveats: ["Links were checked at review time."],
    },
    {
      module: "editorial_quality" as const,
      status: "complete" as const,
      score: 94,
      aiRisk: null,
      summary: "The copy is clear and consistent.",
      caveats: [],
    },
    {
      module: "ai_risk" as const,
      status: "complete" as const,
      score: 70,
      aiRisk: "medium" as const,
      summary: "Provider prose must not define the public wording.",
      caveats: [],
    },
  ];
}

function repository(overrides: Partial<ReportRepository> = {}): ReportRepository {
  return {
    loadReview: vi.fn().mockResolvedValue(review()),
    loadModules: vi.fn().mockResolvedValue(modules()),
    loadRequirements: vi.fn().mockResolvedValue([
      {
        id: "requirement-1",
        category: "Audience",
        requirementText: "Address agency operations leaders.",
        isCritical: true,
        evaluation: "met",
        createdAt: "2026-07-19T09:00:00.000Z",
      },
    ]),
    loadIssues: vi.fn().mockResolvedValue([
      {
        id: "issue-minor",
        module: "brief_fit",
        severity: "minor",
        sourceExcerpt: "x".repeat(500),
        sourceStart: 900,
        explanation: "e".repeat(900),
        suggestedAction: "a".repeat(700),
        createdAt: "2026-07-19T10:03:00.000Z",
      },
      {
        id: "issue-major-editorial",
        module: "editorial_quality",
        severity: "major",
        sourceExcerpt: "An unclear transition",
        sourceStart: 500,
        explanation: "The transition obscures the relationship between claims.",
        suggestedAction: "State the relationship directly.",
        createdAt: "2026-07-19T10:02:00.000Z",
      },
      {
        id: "issue-critical-evidence",
        module: "evidence_citations",
        severity: "critical",
        sourceExcerpt: "Industry research proves the result",
        sourceStart: 700,
        explanation: "The named research is not linked.",
        suggestedAction: "Add the primary source or narrow the claim.",
        createdAt: "2026-07-19T10:01:00.000Z",
      },
      {
        id: "issue-critical-brief",
        module: "brief_fit",
        severity: "critical",
        sourceExcerpt: "For individual creators",
        sourceStart: 300,
        explanation: "The confirmed audience is agency operations leaders.",
        suggestedAction: "Refocus the opening on agency operations.",
        createdAt: "2026-07-19T10:00:00.000Z",
      },
    ]),
    loadDecision: vi.fn().mockResolvedValue({
      decision: "revisions_requested",
      updatedAt: "2026-07-19T11:00:00.000Z",
    }),
    ...overrides,
  };
}

async function load(repo = repository(), token: string | null = accessToken) {
  return getReviewReport(
    { reviewId, accessToken: token, tokenHashSecret, now },
    repo,
  );
}

describe("getReviewReport", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns a bounded explicit DTO for a completed review in deterministic issue order", async () => {
    const result = await load();

    expect(result.kind).toBe("report");
    if (result.kind !== "report") throw new Error("expected report");
    expect(result.report).toMatchObject({
      title: "Launch article acceptance pass",
      contentType: "thought_leadership",
      wordCount: 1280,
      status: "completed",
      score: 86,
      recommendation: "request_revisions",
      decision: {
        value: "revisions_requested",
        recordedAt: "2026-07-19T11:00:00.000Z",
      },
    });
    expect(result.report.modules.map((module) => module.module)).toEqual([
      "brief_fit",
      "evidence_citations",
      "editorial_quality",
      "ai_risk",
    ]);
    expect(result.report.issues.map((issue) => `${issue.severity}:${issue.module}`)).toEqual([
      "critical:brief_fit",
      "critical:evidence_citations",
      "major:editorial_quality",
      "minor:brief_fit",
    ]);
    expect(result.report.issues.at(-1)?.sourceExcerpt?.length).toBeLessThanOrEqual(320);
    expect(result.report.issues.at(-1)?.explanation.length).toBeLessThanOrEqual(600);
    expect(result.report.issues.at(-1)?.suggestedAction.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(result.report)).not.toMatch(
      /anonymousAccessTokenHash|deleteAt|sourceTextEncrypted|originalFilename|objectPath|errorCode|provider|probability|\"id\"/i,
    );
  });

  test("renders partial results with unavailable and not-assessed modules explicitly", async () => {
    const repo = repository({
      loadReview: vi.fn().mockResolvedValue(review({ status: "partial" })),
      loadModules: vi.fn().mockResolvedValue([
        modules()[0],
        {
          ...modules()[1],
          status: "unavailable",
          score: null,
          summary: null,
          caveats: ["Check temporarily unavailable."],
        },
        modules()[2],
        {
          ...modules()[3],
          status: "not_assessed",
          score: null,
          aiRisk: "not_assessed",
          summary: null,
        },
      ]),
    });

    const result = await load(repo);

    expect(result).toMatchObject({
      kind: "report",
      report: {
        status: "partial",
        modules: [
          { module: "brief_fit", status: "complete" },
          { module: "evidence_citations", status: "unavailable", score: null },
          { module: "editorial_quality", status: "complete" },
          { module: "ai_risk", status: "not_assessed", score: null, aiRisk: "not_assessed" },
        ],
      },
    });
  });

  test("returns a failed no-score report without inventing a score or recommendation", async () => {
    const repo = repository({
      loadReview: vi.fn().mockResolvedValue(
        review({
          status: "failed",
          overallScore: null,
          systemRecommendation: "manual_review_required",
        }),
      ),
      loadModules: vi.fn().mockResolvedValue([
        modules()[0],
        { ...modules()[1], status: "unavailable", score: null, summary: null },
        { ...modules()[2], status: "unavailable", score: null, summary: null },
        { ...modules()[3], status: "not_assessed", score: null, aiRisk: "not_assessed", summary: null },
      ]),
    });

    const result = await load(repo);

    expect(result).toMatchObject({
      kind: "report",
      report: { status: "failed", score: null, recommendation: null },
    });
  });

  test("uses fixed manual-review-only wording for high AI risk", async () => {
    const repo = repository({
      loadModules: vi.fn().mockResolvedValue([
        ...modules().slice(0, 3),
        {
          ...modules()[3],
          aiRisk: "high",
          summary: "Reject this cheating author because this is proof of authorship.",
          caveats: ["Proof of authorship means reject this cheating author."],
        },
      ]),
      loadIssues: vi.fn().mockResolvedValue([
        {
          id: "unsafe-ai-copy",
          module: "ai_risk",
          severity: "critical",
          sourceExcerpt: "A passage for context",
          sourceStart: 10,
          explanation: "This proves cheating.",
          suggestedAction: "Reject the author.",
          createdAt: "2026-07-19T10:00:00.000Z",
        },
      ]),
    });

    const result = await load(repo);
    if (result.kind !== "report") throw new Error("expected report");
    const aiModule = result.report.modules.find((module) => module.module === "ai_risk");
    const publicCopy = JSON.stringify({ aiModule, issues: result.report.issues });

    expect(publicCopy).toMatch(/manual review/i);
    expect(publicCopy).not.toMatch(/reject|cheating|proof of authorship/i);
    expect(result.report.issues[0].severity).toBe("major");
  });

  test("returns only the progress path for an authenticated nonterminal review", async () => {
    const repo = repository({
      loadReview: vi.fn().mockResolvedValue(review({ status: "reviewing" })),
    });

    await expect(load(repo)).resolves.toEqual({
      kind: "progress",
      progressPath: `/review/progress/${reviewId}`,
    });
    expect(repo.loadModules).not.toHaveBeenCalled();
    expect(repo.loadRequirements).not.toHaveBeenCalled();
    expect(repo.loadIssues).not.toHaveBeenCalled();
    expect(repo.loadDecision).not.toHaveBeenCalled();
  });

  test.each([
    ["missing cookie", null, review()],
    ["wrong cookie", "wrong-token", review()],
    ["expired review", accessToken, review({ deleteAt: "2026-07-19T11:59:59.000Z" })],
    ["deleted review", accessToken, review({ status: "deleted" })],
    ["missing review", accessToken, null],
  ])("maps %s to the same access error before loading child data", async (_label, token, row) => {
    const repo = repository({ loadReview: vi.fn().mockResolvedValue(row) });

    await expect(load(repo, token)).rejects.toBeInstanceOf(ReviewReportAccessError);
    expect(repo.loadModules).not.toHaveBeenCalled();
    expect(repo.loadIssues).not.toHaveBeenCalled();
  });
});
