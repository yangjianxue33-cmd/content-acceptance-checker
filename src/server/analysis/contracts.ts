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
