import { timingSafeEqual } from "node:crypto";

import type {
  AiRisk,
  AnalysisModule,
  ModuleStatus,
  Severity,
  SystemRecommendation,
} from "@/domain/analysis";
import { hashAccessToken } from "@/server/security/token";
import type { Database } from "@/types/database.generated";

type ContentType = Database["public"]["Enums"]["content_type"];
type RequirementEvaluation =
  Database["public"]["Enums"]["requirement_evaluation"];
export type UserDecision = Database["public"]["Enums"]["user_decision"];
type TerminalStatus = "completed" | "partial" | "failed";

const REPORT_MODULES: readonly AnalysisModule[] = [
  "brief_fit",
  "evidence_citations",
  "editorial_quality",
  "ai_risk",
];

const MODULE_LABELS: Record<AnalysisModule, string> = {
  brief_fit: "Brief fit",
  evidence_citations: "Evidence & citations",
  editorial_quality: "Editorial quality",
  ai_risk: "AI-writing risk",
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

const MODULE_ORDER = new Map(
  REPORT_MODULES.map((module, index) => [module, index]),
);

const LIMITS = {
  title: 180,
  summary: 600,
  caveat: 300,
  requirementCategory: 100,
  requirementText: 600,
  excerpt: 320,
  explanation: 600,
  action: 400,
} as const;

type ReviewRow = {
  anonymousAccessTokenHash: string | null;
  deleteAt: string;
  title: string;
  contentType: ContentType;
  wordCount: number;
  status: Database["public"]["Enums"]["review_status"];
  overallScore: number | null;
  systemRecommendation: SystemRecommendation | null;
};

type ModuleRow = {
  module: AnalysisModule;
  status: ModuleStatus;
  score: number | null;
  aiRisk: AiRisk | null;
  summary: string | null;
  caveats: string[];
};

type RequirementRow = {
  id: string;
  category: string;
  requirementText: string;
  isCritical: boolean;
  evaluation: RequirementEvaluation | null;
  createdAt: string;
};

type IssueRow = {
  id: string;
  module: AnalysisModule;
  severity: Severity;
  sourceExcerpt: string | null;
  sourceStart: number | null;
  explanation: string;
  suggestedAction: string;
  createdAt: string;
};

type DecisionRow = {
  decision: UserDecision;
  updatedAt: string;
};

export type ReportRepository = {
  loadReview(reviewId: string): Promise<ReviewRow | null>;
  loadModules(reviewId: string): Promise<ModuleRow[]>;
  loadRequirements(reviewId: string): Promise<RequirementRow[]>;
  loadIssues(reviewId: string): Promise<IssueRow[]>;
  loadDecision(reviewId: string): Promise<DecisionRow | null>;
};

export type PublicReviewReport = {
  title: string;
  contentType: ContentType;
  wordCount: number;
  status: TerminalStatus;
  score: number | null;
  recommendation: SystemRecommendation | null;
  modules: Array<{
    module: AnalysisModule;
    label: string;
    status: ModuleStatus;
    score: number | null;
    aiRisk: AiRisk | null;
    summary: string | null;
    caveats: string[];
  }>;
  requirements: Array<{
    category: string;
    text: string;
    critical: boolean;
    evaluation: RequirementEvaluation | null;
  }>;
  issues: Array<{
    module: AnalysisModule;
    severity: Severity;
    sourceExcerpt: string | null;
    explanation: string;
    suggestedAction: string;
  }>;
  decision: { value: UserDecision; recordedAt: string } | null;
};

export type ReviewReportResult =
  | { kind: "progress"; progressPath: string }
  | { kind: "report"; report: PublicReviewReport };

export class ReviewReportAccessError extends Error {
  readonly code = "not_found";

  constructor() {
    super("Review not found");
    this.name = "ReviewReportAccessError";
  }
}

function bounded(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function hashesMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function isTerminal(
  status: Database["public"]["Enums"]["review_status"],
): status is TerminalStatus {
  return status === "completed" || status === "partial" || status === "failed";
}

function publicAiSummary(aiRisk: AiRisk | null) {
  switch (aiRisk) {
    case "low":
      return "AI-writing-risk signals are low. This advisory result does not prove authorship or misconduct.";
    case "medium":
      return "AI-writing-risk signals need editorial context. Review the content manually before deciding.";
    case "high":
      return "AI-writing-risk signals are high. Manual review is required; this does not prove authorship or misconduct.";
    default:
      return "AI-writing risk was not assessed.";
  }
}

export async function getReviewReport(
  input: {
    reviewId: string;
    accessToken: string | null;
    tokenHashSecret: string;
    now?: Date;
  },
  repository: ReportRepository,
): Promise<ReviewReportResult> {
  if (!input.accessToken) throw new ReviewReportAccessError();

  const review = await repository.loadReview(input.reviewId);
  const suppliedHash = hashAccessToken(input.accessToken, input.tokenHashSecret);
  const currentTime = input.now ?? new Date();
  if (
    !review ||
    !review.anonymousAccessTokenHash ||
    review.status === "deleted" ||
    new Date(review.deleteAt).getTime() <= currentTime.getTime() ||
    !hashesMatch(suppliedHash, review.anonymousAccessTokenHash)
  ) {
    throw new ReviewReportAccessError();
  }

  if (!isTerminal(review.status)) {
    return {
      kind: "progress",
      progressPath: `/review/progress/${input.reviewId}`,
    };
  }

  const [moduleRows, requirementRows, issueRows, decisionRow] =
    await Promise.all([
      repository.loadModules(input.reviewId),
      repository.loadRequirements(input.reviewId),
      repository.loadIssues(input.reviewId),
      repository.loadDecision(input.reviewId),
    ]);
  const modulesByName = new Map(
    moduleRows.map((module) => [module.module, module]),
  );
  const highAiRisk =
    modulesByName.get("ai_risk")?.status === "complete" &&
    modulesByName.get("ai_risk")?.aiRisk === "high";

  return {
    kind: "report",
    report: {
      title: bounded(review.title, LIMITS.title),
      contentType: review.contentType,
      wordCount: review.wordCount,
      status: review.status,
      score: review.overallScore,
      recommendation:
        review.status === "failed" || review.overallScore === null
          ? null
          : review.systemRecommendation,
      modules: REPORT_MODULES.map((moduleName) => {
        const row = modulesByName.get(moduleName);
        if (!row) {
          return {
            module: moduleName,
            label: MODULE_LABELS[moduleName],
            status: "unavailable" as const,
            score: null,
            aiRisk: null,
            summary: null,
            caveats: ["This check is unavailable."],
          };
        }
        return {
          module: moduleName,
          label: MODULE_LABELS[moduleName],
          status: row.status,
          score: row.score,
          aiRisk: row.aiRisk,
          summary:
            moduleName === "ai_risk"
              ? publicAiSummary(row.aiRisk)
              : row.summary
                ? bounded(row.summary, LIMITS.summary)
                : null,
          caveats:
            moduleName === "ai_risk" && row.aiRisk === "high"
              ? [
                  "AI-writing-risk signals are advisory. Complete a manual review before deciding.",
                ]
              : row.caveats.map((caveat) =>
                  bounded(caveat, LIMITS.caveat),
                ),
        };
      }),
      requirements: [...requirementRows]
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .map((requirement) => ({
          category: bounded(
            requirement.category,
            LIMITS.requirementCategory,
          ),
          text: bounded(requirement.requirementText, LIMITS.requirementText),
          critical: requirement.isCritical,
          evaluation: requirement.evaluation,
        })),
      issues: [...issueRows]
        .sort(
          (left, right) =>
            SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
            (MODULE_ORDER.get(left.module) ?? Number.MAX_SAFE_INTEGER) -
              (MODULE_ORDER.get(right.module) ?? Number.MAX_SAFE_INTEGER) ||
            (left.sourceStart ?? Number.MAX_SAFE_INTEGER) -
              (right.sourceStart ?? Number.MAX_SAFE_INTEGER) ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .map((issue) => {
          const safeHighRiskIssue = highAiRisk && issue.module === "ai_risk";
          return {
            module: issue.module,
            severity:
              issue.module === "ai_risk" && issue.severity === "critical"
                ? ("major" as const)
                : issue.severity,
            sourceExcerpt: issue.sourceExcerpt
              ? bounded(issue.sourceExcerpt, LIMITS.excerpt)
              : null,
            explanation: safeHighRiskIssue
              ? "This passage contributed to a high AI-writing-risk signal. The signal is advisory and does not prove authorship or misconduct."
              : bounded(issue.explanation, LIMITS.explanation),
            suggestedAction: safeHighRiskIssue
              ? "Complete a manual review using editorial context and source materials."
              : bounded(issue.suggestedAction, LIMITS.action),
          };
        }),
      decision: decisionRow
        ? { value: decisionRow.decision, recordedAt: decisionRow.updatedAt }
        : null,
    },
  };
}

function productionSecurityConfig() {
  const tokenHashSecret = process.env.TOKEN_HASH_SECRET;
  if (!tokenHashSecret) throw new Error("Missing token hash secret");
  return tokenHashSecret;
}

export async function getProductionReviewReport(input: {
  reviewId: string;
  accessToken: string | null;
}) {
  const { createClient } = await import("@/server/supabase/admin");
  const client = createClient();
  const repository: ReportRepository = {
    async loadReview(reviewId) {
      const { data, error } = await client
        .from("reviews")
        .select(
          "anonymous_access_token_hash, delete_at, title, content_type, word_count, status, overall_score, system_recommendation",
        )
        .eq("id", reviewId)
        .maybeSingle();
      if (error) throw new Error("review_report_load_failed");
      return data
        ? {
            anonymousAccessTokenHash: data.anonymous_access_token_hash,
            deleteAt: data.delete_at,
            title: data.title,
            contentType: data.content_type,
            wordCount: data.word_count,
            status: data.status,
            overallScore: data.overall_score,
            systemRecommendation: data.system_recommendation,
          }
        : null;
    },
    async loadModules(reviewId) {
      const { data, error } = await client
        .from("analysis_modules")
        .select("module, status, score, ai_risk, summary, caveats")
        .eq("review_id", reviewId);
      if (error) throw new Error("review_report_load_failed");
      return (data ?? []).map((row) => ({
        module: row.module,
        status: row.status,
        score: row.score,
        aiRisk: row.ai_risk,
        summary: row.summary,
        caveats: row.caveats,
      }));
    },
    async loadRequirements(reviewId) {
      const { data, error } = await client
        .from("requirements")
        .select(
          "id, category, requirement_text, is_critical, evaluation_result, created_at",
        )
        .eq("review_id", reviewId)
        .eq("user_confirmed", true);
      if (error) throw new Error("review_report_load_failed");
      return (data ?? []).map((row) => ({
        id: row.id,
        category: row.category,
        requirementText: row.requirement_text,
        isCritical: row.is_critical,
        evaluation: row.evaluation_result,
        createdAt: row.created_at,
      }));
    },
    async loadIssues(reviewId) {
      const { data, error } = await client
        .from("issues")
        .select(
          "id, module, severity, source_excerpt, source_start, explanation, suggested_action, created_at",
        )
        .eq("review_id", reviewId);
      if (error) throw new Error("review_report_load_failed");
      return (data ?? []).map((row) => ({
        id: row.id,
        module: row.module,
        severity: row.severity,
        sourceExcerpt: row.source_excerpt,
        sourceStart: row.source_start,
        explanation: row.explanation,
        suggestedAction: row.suggested_action,
        createdAt: row.created_at,
      }));
    },
    async loadDecision(reviewId) {
      const { data, error } = await client
        .from("review_decisions")
        .select("decision, updated_at")
        .eq("review_id", reviewId)
        .maybeSingle();
      if (error) throw new Error("review_report_load_failed");
      return data
        ? { decision: data.decision, updatedAt: data.updated_at }
        : null;
    },
  };

  return getReviewReport(
    {
      ...input,
      tokenHashSecret: productionSecurityConfig(),
    },
    repository,
  );
}
