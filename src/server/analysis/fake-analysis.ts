import {
  briefFitAnalysisSchema,
  briefRequirementSchema,
  editorialQualityAnalysisSchema,
  evidenceCitationsAnalysisSchema,
  type ExtractBriefInput,
  type ModuleAnalysisInput,
  type ModuleWritingAnalyzer,
  type StructuredWritingAnalyzer,
} from "@/server/analysis/contracts";
import type { AiRiskProvider } from "@/server/analysis/gptzero-provider";

function hasMarker(input: ModuleAnalysisInput, marker: string) {
  return input.articleText.includes(marker);
}

export class FakeWritingAnalyzer
  implements StructuredWritingAnalyzer, ModuleWritingAnalyzer
{
  async extractBrief(input: ExtractBriefInput) {
    void input;
    return [
      briefRequirementSchema.parse({
        category: "Audience",
        text: "Address the intended editorial audience",
        isCritical: true,
        sourceExcerpt: "Audience acceptance criterion",
      }),
    ];
  }

  async analyzeBriefFit(input: ModuleAnalysisInput) {
    if (hasMarker(input, "E2E_TOTAL_FAILURE")) {
      throw new Error("fake_total_failure");
    }
    const criticalMissing = hasMarker(input, "E2E_CRITICAL_MISSING");
    const firstRequirement = input.requirements[0];
    return briefFitAnalysisSchema.parse({
      score: criticalMissing ? 40 : 92,
      summary: criticalMissing
        ? "A confirmed acceptance requirement needs revision."
        : "The confirmed brief requirements are addressed.",
      caveats: [],
      issues:
        criticalMissing && firstRequirement
          ? [
              {
                issueType: "missing_required_point",
                severity: "critical",
                sourceExcerpt: null,
                sourceStart: null,
                sourceEnd: null,
                relatedRequirementId: firstRequirement.id,
                explanation: "A required brief point is not covered.",
                suggestedAction: "Add the required point before approval.",
                confidence: "high",
                includeInWriterChecklist: true,
              },
            ]
          : [],
      requirementEvaluations: input.requirements.map((requirement) => ({
        requirementId: requirement.id,
        result: criticalMissing ? "missing" : "met",
      })),
    });
  }

  async analyzeEvidenceCitations(input: ModuleAnalysisInput) {
    if (hasMarker(input, "E2E_PARTIAL_FAILURE")) {
      throw new Error("fake_partial_failure");
    }
    if (hasMarker(input, "E2E_TOTAL_FAILURE")) {
      throw new Error("fake_total_failure");
    }
    return evidenceCitationsAnalysisSchema.parse({
      score: 88,
      summary: "Evidence and citation signals are ready for editorial review.",
      caveats: [],
      issues: [],
      citationUrls: [],
    });
  }

  async analyzeEditorialQuality(input: ModuleAnalysisInput) {
    if (hasMarker(input, "E2E_TOTAL_FAILURE")) {
      throw new Error("fake_total_failure");
    }
    return editorialQualityAnalysisSchema.parse({
      score: 90,
      summary: "The article is clear and structurally consistent.",
      caveats: [],
      issues: [],
    });
  }
}

export class FakeAiRiskProvider implements AiRiskProvider {
  async assess(input: { articleText: string; wordCount: number }) {
    if (input.articleText.includes("E2E_TOTAL_FAILURE")) {
      return {
        status: "unavailable" as const,
        risk: null,
        confidence: null,
        caveats: ["AI-writing risk could not be assessed."],
        errorCode: "provider_failed" as const,
      };
    }
    if (input.wordCount < 300) {
      return {
        status: "not_assessed" as const,
        risk: "not_assessed" as const,
        confidence: null,
        caveats: ["AI-writing risk requires at least 300 words."],
      };
    }
    return {
      status: "complete" as const,
      risk: input.articleText.includes("E2E_HIGH_AI_RISK")
        ? ("high" as const)
        : ("low" as const),
      confidence: "high" as const,
      caveats: [
        "This signal is advisory and requires human editorial judgment.",
      ],
    };
  }
}
