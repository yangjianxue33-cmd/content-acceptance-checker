import type {
  AiRisk,
  AnalysisModule,
  Issue,
  ModuleStatus,
  SystemRecommendation,
} from "@/domain/analysis";
import { recommendAction } from "@/domain/recommendation";
import { calculateReviewScore } from "@/domain/scoring";
import type { Database } from "@/types/database.generated";

type FinalizableModule = {
  module: AnalysisModule;
  status: ModuleStatus;
  aiRisk: AiRisk | null;
  issues: Issue[];
};

type Finalization = {
  status: "completed" | "partial" | "failed";
  overallScore: number | null;
  systemRecommendation: SystemRecommendation;
};

export type FinalizationRepository = {
  loadModules(reviewId: string): Promise<FinalizableModule[]>;
  persistFinalization(reviewId: string, result: Finalization): Promise<void>;
};

export async function finalizeReview(
  reviewId: string,
  repository: FinalizationRepository,
) {
  const modules = await repository.loadModules(reviewId);
  if (
    modules.length !== 4 ||
    modules.some(
      (module) => module.status === "queued" || module.status === "reviewing",
    )
  ) {
    return null;
  }

  const completed = modules
    .filter((module) => module.status === "complete")
    .map((module) => ({
      module: module.module,
      issues: module.issues,
      ...(module.module === "ai_risk" && module.aiRisk !== null && module.aiRisk !== "not_assessed"
        ? { aiRisk: module.aiRisk }
        : {}),
    }));
  const score = calculateReviewScore(completed);
  const availableModuleCount = modules.filter(
    (module) => module.status === "complete" || module.status === "not_assessed",
  ).length;
  const aiRisk =
    modules.find((module) => module.module === "ai_risk")?.aiRisk ??
    "not_assessed";
  const systemRecommendation =
    completed.length < 2
      ? "manual_review_required"
      : recommendAction({
          issues: completed.flatMap((module) => module.issues),
          aiRisk,
          availableModuleCount,
        });
  const unavailableCount = modules.filter(
    (module) => module.status === "unavailable",
  ).length;
  const status =
    completed.length < 2
      ? "failed"
      : unavailableCount > 0
        ? "partial"
        : "completed";
  const result: Finalization = {
    status,
    overallScore: score?.overall ?? null,
    systemRecommendation,
  };
  await repository.persistFinalization(reviewId, result);
  return result;
}

export async function finalizeProductionReview(reviewId: string) {
  const { createClient } = await import("@/server/supabase/admin");
  const client = createClient();
  return finalizeReview(reviewId, {
    async loadModules(id) {
      const [modulesResult, issuesResult] = await Promise.all([
        client
          .from("analysis_modules")
          .select("module, status, ai_risk")
          .eq("review_id", id),
        client
          .from("issues")
          .select("id, module, severity")
          .eq("review_id", id),
      ]);
      if (modulesResult.error || issuesResult.error) {
        throw new Error("finalization_load_failed");
      }
      return (modulesResult.data ?? []).map((module) => ({
        module: module.module,
        status: module.status,
        aiRisk: module.ai_risk,
        issues: (issuesResult.data ?? [])
          .filter((issue) => issue.module === module.module)
          .map((issue) => ({
            id: issue.id,
            module: issue.module,
            severity: issue.severity,
          })),
      }));
    },
    async persistFinalization(id, result) {
      type FinalizeArgs =
        Database["public"]["Functions"]["finalize_review_analysis"]["Args"];
      const { data, error } = await client.rpc("finalize_review_analysis", {
        p_review_id: id,
        p_overall_score: result.overallScore,
        p_recommendation: result.systemRecommendation,
      } as unknown as FinalizeArgs);
      if (error || data !== result.status) {
        throw new Error("finalization_persistence_failed");
      }
    },
  });
}
