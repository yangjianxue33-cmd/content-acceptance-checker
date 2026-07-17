import { z } from "zod";

export const analysisModuleSchema = z.enum([
  "brief_fit",
  "evidence_citations",
  "editorial_quality",
  "ai_risk",
]);

export const moduleStatusSchema = z.enum([
  "queued",
  "reviewing",
  "complete",
  "not_assessed",
  "unavailable",
]);

export const severitySchema = z.enum(["critical", "major", "minor"]);

export const aiRiskSchema = z.enum(["low", "medium", "high", "not_assessed"]);

export const systemRecommendationSchema = z.enum([
  "ready_to_approve",
  "request_revisions",
  "manual_review_required",
]);

export const issueSchema = z
  .object({
    id: z.string(),
    module: analysisModuleSchema,
    severity: severitySchema,
  })
  .strict();

export const completedModuleSchema = z
  .object({
    module: analysisModuleSchema,
    issues: z.array(issueSchema),
    aiRisk: aiRiskSchema.exclude(["not_assessed"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.module === "ai_risk" && value.aiRisk === undefined) {
      context.addIssue({
        code: "custom",
        message: "aiRisk is required for ai_risk modules",
        path: ["aiRisk"],
      });
    }

    if (value.module !== "ai_risk" && value.aiRisk !== undefined) {
      context.addIssue({
        code: "custom",
        message: "aiRisk is only allowed for ai_risk modules",
        path: ["aiRisk"],
      });
    }

    value.issues.forEach((issue, index) => {
      if (issue.module !== value.module) {
        context.addIssue({
          code: "custom",
          message: "Issue module must match the completed module",
          path: ["issues", index, "module"],
        });
      }
    });
  });

export const reviewScoreSchema = z
  .object({
    overall: z.number().int().min(0).max(100),
    dimensions: z.partialRecord(analysisModuleSchema, z.number().int().min(0).max(100)),
    normalizedWeights: z.partialRecord(analysisModuleSchema, z.number().min(0).max(1)),
  })
  .strict();
