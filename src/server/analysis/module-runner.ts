import type { AiRisk, AnalysisModule, ModuleStatus } from "@/domain/analysis";
import type {
  ModuleAnalysisInput,
  ModuleWritingAnalyzer,
} from "@/server/analysis/contracts";
import type { AiRiskProvider } from "@/server/analysis/gptzero-provider";
import type { SafeUrlResult } from "@/server/security/safe-url";
import type { Database } from "@/types/database.generated";

export const ANALYSIS_MODULES = [
  "brief_fit",
  "evidence_citations",
  "editorial_quality",
  "ai_risk",
] as const satisfies readonly AnalysisModule[];

type PersistedIssue = {
  issueType: string;
  severity: "critical" | "major" | "minor";
  sourceExcerpt: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  relatedRequirementId: string | null;
  explanation: string;
  suggestedAction: string;
  confidence: "low" | "medium" | "high" | null;
  includeInWriterChecklist: boolean;
};

type CitationCheck = {
  url: string | null;
  statusCode: number | null;
  result: "reachable" | "http_error" | "unsafe" | "unavailable";
  reasonCode: string | null;
};

type RequirementEvaluation = {
  requirementId: string;
  result: "met" | "partial" | "missing" | "not_assessed";
};

export type PersistedModuleResult = {
  module: AnalysisModule;
  status: Extract<ModuleStatus, "complete" | "not_assessed" | "unavailable">;
  score: number | null;
  aiRisk: AiRisk | null;
  summary: string | null;
  caveats: string[];
  errorCode: string | null;
  issues: PersistedIssue[];
  citationChecks: CitationCheck[];
  requirementEvaluations: RequirementEvaluation[];
};

export type ModuleRunnerRepository = {
  claim(reviewId: string, module: AnalysisModule): Promise<boolean>;
  loadInput(reviewId: string): Promise<ModuleAnalysisInput>;
  save(reviewId: string, result: PersistedModuleResult): Promise<void>;
};

export type ModuleRunnerDependencies = {
  repository: ModuleRunnerRepository;
  analyzer: ModuleWritingAnalyzer;
  aiRiskProvider: AiRiskProvider;
  validateCitation: (url: string) => Promise<SafeUrlResult>;
};

type AnalysisProviderFactories = {
  createAnalyzer: () => ModuleWritingAnalyzer;
  createAiRiskProvider: () => AiRiskProvider;
};

const unavailableAnalyzer: ModuleWritingAnalyzer = {
  async analyzeBriefFit() {
    throw new Error("provider_unavailable");
  },
  async analyzeEvidenceCitations() {
    throw new Error("provider_unavailable");
  },
  async analyzeEditorialQuality() {
    throw new Error("provider_unavailable");
  },
};

const unavailableAiRiskProvider: AiRiskProvider = {
  async assess() {
    return {
      status: "unavailable",
      risk: null,
      confidence: null,
      caveats: ["AI-writing risk could not be assessed."],
      errorCode: "provider_failed",
    };
  },
};

export function createIsolatedAnalysisProviders(
  factories: AnalysisProviderFactories,
): Pick<ModuleRunnerDependencies, "analyzer" | "aiRiskProvider"> {
  let analyzer = unavailableAnalyzer;
  let aiRiskProvider = unavailableAiRiskProvider;
  try {
    analyzer = factories.createAnalyzer();
  } catch {}
  try {
    aiRiskProvider = factories.createAiRiskProvider();
  } catch {}
  return { analyzer, aiRiskProvider };
}

function unavailable(module: AnalysisModule): PersistedModuleResult {
  return {
    module,
    status: "unavailable",
    score: null,
    aiRisk: null,
    summary: null,
    caveats: ["This check is temporarily unavailable."],
    errorCode: "provider_failed",
    issues: [],
    citationChecks: [],
    requirementEvaluations: [],
  };
}

function baseResult(
  module: Exclude<AnalysisModule, "ai_risk">,
  result: {
    score: number;
    summary: string;
    caveats: string[];
    issues: PersistedIssue[];
  },
): PersistedModuleResult {
  return {
    module,
    status: "complete",
    score: result.score,
    aiRisk: null,
    summary: result.summary,
    caveats: result.caveats,
    errorCode: null,
    issues: result.issues,
    citationChecks: [],
    requirementEvaluations: [],
  };
}

function safeReason(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z_]{1,40}$/.test(error.code)
  ) {
    return error.code;
  }
  return "network_error";
}

async function executeModule(
  module: AnalysisModule,
  input: ModuleAnalysisInput,
  dependencies: ModuleRunnerDependencies,
): Promise<PersistedModuleResult> {
  if (module === "brief_fit") {
    if (!input.briefText || input.requirements.length === 0) {
      return {
        module,
        status: "not_assessed",
        score: null,
        aiRisk: null,
        summary: "Brief fit was not assessed because no brief was supplied.",
        caveats: [],
        errorCode: null,
        issues: [],
        citationChecks: [],
        requirementEvaluations: [],
      };
    }
    const result = await dependencies.analyzer.analyzeBriefFit(input);
    return {
      ...baseResult(module, result),
      requirementEvaluations: result.requirementEvaluations,
    };
  }
  if (module === "editorial_quality") {
    return baseResult(
      module,
      await dependencies.analyzer.analyzeEditorialQuality(input),
    );
  }
  if (module === "evidence_citations") {
    const result = await dependencies.analyzer.analyzeEvidenceCitations(input);
    const checks = await Promise.all(
      result.citationUrls.map(async (url): Promise<CitationCheck> => {
        try {
          return await dependencies.validateCitation(url);
        } catch (error) {
          return {
            url: null,
            statusCode: null,
            result: "unsafe",
            reasonCode: safeReason(error),
          };
        }
      }),
    );
    const unsafe = checks.some(
      (check) => check.result === "unsafe" || check.result === "unavailable",
    );
    return {
      ...baseResult(module, result),
      caveats: unsafe
        ? [
            ...result.caveats,
            "One or more citations could not be checked safely.",
          ]
        : result.caveats,
      citationChecks: checks,
    };
  }

  const assessment = await dependencies.aiRiskProvider.assess({
    articleText: input.articleText,
    wordCount: input.wordCount,
  });
  if (assessment.status === "unavailable") {
    return {
      ...unavailable(module),
      caveats: assessment.caveats,
      errorCode: assessment.errorCode,
    };
  }
  return {
    module,
    status: assessment.status,
    score: null,
    aiRisk: assessment.risk,
    summary:
      assessment.status === "complete"
        ? "AI-writing risk assessed."
        : "AI-writing risk not assessed.",
    caveats: assessment.caveats,
    errorCode: null,
    issues: [],
    citationChecks: [],
    requirementEvaluations: [],
  };
}

export async function runModule(
  reviewId: string,
  module: AnalysisModule,
  dependencies: ModuleRunnerDependencies,
) {
  const claimed = await dependencies.repository.claim(reviewId, module);
  if (!claimed) return "skipped" as const;

  let result: PersistedModuleResult;
  try {
    const input = await dependencies.repository.loadInput(reviewId);
    result = await executeModule(module, input, dependencies);
  } catch {
    result = unavailable(module);
  }
  await dependencies.repository.save(reviewId, result);
  return result.status;
}

export function runAllModules(
  reviewId: string,
  dependencies: ModuleRunnerDependencies,
) {
  return Promise.all(
    ANALYSIS_MODULES.map((module) => runModule(reviewId, module, dependencies)),
  );
}

function byteaBytes(value: string) {
  if (!value.startsWith("\\x")) throw new Error("source_unavailable");
  return Buffer.from(value.slice(2), "hex");
}

export async function createProductionModuleRunnerDependencies(): Promise<ModuleRunnerDependencies> {
  const [
    { createClient },
    { decryptSourceText },
    { fetchSafeUrl },
    { isFakeAnalysisEnabled },
  ] = await Promise.all([
    import("@/server/supabase/admin"),
    import("@/server/security/source-text-encryption"),
    import("@/server/security/safe-url"),
    import("@/server/security/fake-analysis-guard"),
  ]);
  const encryptionKey = process.env.SOURCE_TEXT_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("Missing source encryption key");
  const client = createClient();
  let providers: Pick<
    ModuleRunnerDependencies,
    "analyzer" | "aiRiskProvider"
  >;
  if (isFakeAnalysisEnabled()) {
    const { FakeAiRiskProvider, FakeWritingAnalyzer } = await import(
      "@/server/analysis/fake-analysis"
    );
    providers = {
      analyzer: new FakeWritingAnalyzer(),
      aiRiskProvider: new FakeAiRiskProvider(),
    };
  } else {
    const [{ OpenAIStructuredWritingAnalyzer }, { GptZeroAiRiskProvider }] =
      await Promise.all([
        import("@/server/analysis/openai-analyzer"),
        import("@/server/analysis/gptzero-provider"),
      ]);
    providers = createIsolatedAnalysisProviders({
      createAnalyzer: () => new OpenAIStructuredWritingAnalyzer(),
      createAiRiskProvider: () => new GptZeroAiRiskProvider(),
    });
  }

  return {
    ...providers,
    validateCitation: fetchSafeUrl,
    repository: {
      async claim(reviewId, module) {
        const { data, error } = await client.rpc("claim_analysis_module", {
          p_review_id: reviewId,
          p_module: module,
        });
        if (error) throw new Error("module_claim_failed");
        return data;
      },
      async loadInput(reviewId) {
        const [reviewResult, requirementsResult, briefFileResult] =
          await Promise.all([
            client
              .from("reviews")
              .select("source_text_encrypted, word_count")
              .eq("id", reviewId)
              .single(),
            client
              .from("requirements")
              .select("id, category, requirement_text, is_critical")
              .eq("review_id", reviewId)
              .eq("user_confirmed", true),
            client
              .from("review_files")
              .select("object_path")
              .eq("review_id", reviewId)
              .eq("file_kind", "brief")
              .maybeSingle(),
          ]);
        if (
          reviewResult.error ||
          requirementsResult.error ||
          briefFileResult.error ||
          !reviewResult.data.source_text_encrypted
        ) {
          throw new Error("source_unavailable");
        }

        let briefText: string | null = null;
        if (briefFileResult.data?.object_path) {
          const { data, error } = await client.storage
            .from("review-source")
            .download(briefFileResult.data.object_path);
          if (error || !data) throw new Error("source_unavailable");
          briefText = await data.text();
        }
        return {
          articleText: decryptSourceText(
            byteaBytes(reviewResult.data.source_text_encrypted),
            encryptionKey,
          ),
          wordCount: reviewResult.data.word_count,
          briefText,
          requirements: (requirementsResult.data ?? []).map((requirement) => ({
            id: requirement.id,
            category: requirement.category,
            text: requirement.requirement_text,
            isCritical: requirement.is_critical,
          })),
        };
      },
      async save(reviewId, result) {
        type PersistArgs =
          Database["public"]["Functions"]["persist_analysis_module_result"]["Args"];
        const { error } = await client.rpc("persist_analysis_module_result", {
          p_review_id: reviewId,
          p_module: result.module,
          p_status: result.status,
          p_score: result.score,
          p_ai_risk: result.aiRisk,
          p_summary: result.summary,
          p_caveats: result.caveats,
          p_error_code: result.errorCode,
          p_issues: result.issues.map((issue) => ({
            issue_type: issue.issueType,
            severity: issue.severity,
            source_excerpt: issue.sourceExcerpt,
            source_start: issue.sourceStart,
            source_end: issue.sourceEnd,
            related_requirement_id: issue.relatedRequirementId,
            explanation: issue.explanation,
            suggested_action: issue.suggestedAction,
            confidence: issue.confidence,
            include_in_writer_checklist: issue.includeInWriterChecklist,
          })),
          p_citation_checks: result.citationChecks.map((check) => ({
            normalized_url: check.url,
            status_code: check.statusCode,
            result_category: check.result,
            reason_code: check.reasonCode,
          })),
          p_requirement_evaluations: result.requirementEvaluations.map(
            (evaluation) => ({
              requirement_id: evaluation.requirementId,
              result: evaluation.result,
            }),
          ),
        } as unknown as PersistArgs);
        if (error) throw new Error("module_persistence_failed");
      },
    },
  };
}

export async function runProductionModules(reviewId: string) {
  return runAllModules(
    reviewId,
    await createProductionModuleRunnerDependencies(),
  );
}
