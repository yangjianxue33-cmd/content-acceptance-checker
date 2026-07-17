import type { AiRisk, AnalysisModule, CompletedModule, Issue } from "@/domain/analysis";

export function completedModule(
  module: AnalysisModule,
  options: {
    aiRisk?: Exclude<AiRisk, "not_assessed">;
    issues?: readonly Issue[];
  } = {},
): CompletedModule {
  return {
    module,
    issues: options.issues ?? [],
    ...(options.aiRisk === undefined ? {} : { aiRisk: options.aiRisk }),
  };
}

export function issue(
  module: AnalysisModule,
  severity: Issue["severity"],
): Issue {
  return { id: `${module}-${severity}`, module, severity };
}
