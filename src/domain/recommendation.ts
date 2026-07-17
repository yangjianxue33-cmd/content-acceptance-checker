import type { AiRisk, Issue, SystemRecommendation } from "./analysis";

export function recommendAction(input: {
  issues: ReadonlyArray<Issue>;
  aiRisk: AiRisk;
  availableModuleCount: number;
}): SystemRecommendation {
  if (input.availableModuleCount < 2 || input.aiRisk === "high") {
    return "manual_review_required";
  }

  if (input.issues.some((issue) => issue.severity !== "minor")) {
    return "request_revisions";
  }

  return "ready_to_approve";
}
