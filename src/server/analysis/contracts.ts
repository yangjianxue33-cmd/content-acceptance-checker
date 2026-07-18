import { z } from "zod";

export const MAX_REQUIREMENTS = 30;
export const MAX_REQUIREMENT_CATEGORY_LENGTH = 80;
export const MAX_REQUIREMENT_TEXT_LENGTH = 1_000;
export const MAX_SOURCE_EXCERPT_LENGTH = 500;

export const briefRequirementSchema = z.strictObject({
  category: z.string().trim().min(1).max(MAX_REQUIREMENT_CATEGORY_LENGTH),
  text: z.string().trim().min(1).max(MAX_REQUIREMENT_TEXT_LENGTH),
  isCritical: z.boolean(),
  sourceExcerpt: z.string().trim().min(1).max(MAX_SOURCE_EXCERPT_LENGTH),
});

export const briefRequirementsSchema = z.strictObject({
  requirements: z.array(briefRequirementSchema).min(1).max(MAX_REQUIREMENTS),
});

export type BriefRequirement = z.infer<typeof briefRequirementSchema>;

export type ExtractBriefInput = {
  articleText: string;
  briefText: string;
};

export interface StructuredWritingAnalyzer {
  extractBrief(input: ExtractBriefInput): Promise<BriefRequirement[]>;
}

export interface ModuleWritingAnalyzer {
  analyzeBriefFit(input: ModuleAnalysisInput): Promise<BriefFitAnalysis>;
  analyzeEvidenceCitations(
    input: ModuleAnalysisInput,
  ): Promise<EvidenceCitationsAnalysis>;
  analyzeEditorialQuality(
    input: ModuleAnalysisInput,
  ): Promise<EditorialQualityAnalysis>;
}

export const moduleIssueSchema = z.strictObject({
  issueType: z.string().trim().min(1).max(80),
  severity: z.enum(["critical", "major", "minor"]),
  sourceExcerpt: z.string().trim().min(1).max(500).nullable(),
  sourceStart: z.number().int().min(0).nullable(),
  sourceEnd: z.number().int().min(0).nullable(),
  relatedRequirementId: z.uuid().nullable(),
  explanation: z.string().trim().min(1).max(1_000),
  suggestedAction: z.string().trim().min(1).max(1_000),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  includeInWriterChecklist: z.boolean(),
});

const commonModuleAnalysisShape = {
  score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(1).max(500),
  caveats: z.array(z.string().trim().min(1).max(300)).max(10),
  issues: z.array(moduleIssueSchema).max(50),
};

export const briefFitAnalysisSchema = z.strictObject({
  ...commonModuleAnalysisShape,
  requirementEvaluations: z
    .array(
      z.strictObject({
        requirementId: z.uuid(),
        result: z.enum(["met", "partial", "missing", "not_assessed"]),
      }),
    )
    .max(MAX_REQUIREMENTS),
});

export const evidenceCitationsAnalysisSchema = z.strictObject({
  ...commonModuleAnalysisShape,
  citationUrls: z.array(z.url().max(2_048)).max(50),
});

export const editorialQualityAnalysisSchema = z.strictObject({
  ...commonModuleAnalysisShape,
});

export type ModuleRequirement = {
  id: string;
  category: string;
  text: string;
  isCritical: boolean;
};

export type ModuleAnalysisInput = {
  articleText: string;
  wordCount: number;
  briefText: string | null;
  requirements: ModuleRequirement[];
};

export type BriefFitAnalysis = z.infer<typeof briefFitAnalysisSchema>;
export type EvidenceCitationsAnalysis = z.infer<
  typeof evidenceCitationsAnalysisSchema
>;
export type EditorialQualityAnalysis = z.infer<
  typeof editorialQualityAnalysisSchema
>;
