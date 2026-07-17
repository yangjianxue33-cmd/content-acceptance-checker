export type AnalysisModule =
  | "brief_fit"
  | "evidence_citations"
  | "editorial_quality"
  | "ai_risk";

export type ModuleStatus =
  | "queued"
  | "reviewing"
  | "complete"
  | "not_assessed"
  | "unavailable";

export type Severity = "critical" | "major" | "minor";

export type AiRisk = "low" | "medium" | "high" | "not_assessed";

export type SystemRecommendation =
  | "ready_to_approve"
  | "request_revisions"
  | "manual_review_required";

export interface Issue {
  id: string;
  module: AnalysisModule;
  severity: Severity;
}

export interface CompletedModule {
  module: AnalysisModule;
  issues: readonly Issue[];
  aiRisk?: Exclude<AiRisk, "not_assessed">;
}

export interface ReviewScore {
  overall: number;
  dimensions: Partial<Record<AnalysisModule, number>>;
  normalizedWeights: Partial<Record<AnalysisModule, number>>;
}
