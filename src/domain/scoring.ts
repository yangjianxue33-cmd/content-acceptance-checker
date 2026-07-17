import type { AiRisk, AnalysisModule, CompletedModule, ReviewScore, Severity } from "./analysis";

const BASE_WEIGHT_POINTS: Record<AnalysisModule, number> = {
  brief_fit: 30,
  evidence_citations: 25,
  editorial_quality: 25,
  ai_risk: 20,
};

const ISSUE_PENALTIES: Record<Severity, number> = {
  critical: 25,
  major: 10,
  minor: 3,
};

const AI_RISK_SCORES: Record<Exclude<AiRisk, "not_assessed">, number> = {
  low: 100,
  medium: 70,
  high: 40,
};

function calculateDimension(module: CompletedModule): number {
  if (module.module === "ai_risk") {
    return module.aiRisk === undefined ? 0 : AI_RISK_SCORES[module.aiRisk];
  }

  const penalties = module.issues.reduce(
    (total, issue) => total + ISSUE_PENALTIES[issue.severity],
    0,
  );

  return Math.max(0, 100 - penalties);
}

export function calculateReviewScore(
  modules: ReadonlyArray<CompletedModule>,
): ReviewScore | null {
  const completedModuleNames = new Set<AnalysisModule>();

  for (const moduleResult of modules) {
    if (completedModuleNames.has(moduleResult.module)) {
      throw new RangeError(`Duplicate completed module: ${moduleResult.module}`);
    }

    completedModuleNames.add(moduleResult.module);
  }

  if (modules.length < 2) {
    return null;
  }

  const totalWeight = modules.reduce(
    (total, module) => total + BASE_WEIGHT_POINTS[module.module],
    0,
  );
  const dimensions: ReviewScore["dimensions"] = {};
  const normalizedWeights: ReviewScore["normalizedWeights"] = {};
  let weightedSum = 0;

  for (const moduleResult of modules) {
    const dimension = calculateDimension(moduleResult);
    const normalizedWeight =
      BASE_WEIGHT_POINTS[moduleResult.module] / totalWeight;

    dimensions[moduleResult.module] = dimension;
    normalizedWeights[moduleResult.module] = normalizedWeight;
    weightedSum += dimension * normalizedWeight;
  }

  return {
    overall: Math.round(weightedSum),
    dimensions,
    normalizedWeights,
  };
}
