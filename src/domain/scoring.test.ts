import { describe, expect, it } from "vitest";

import { completedModule, issue } from "@/test/fixtures/module-results";

import { completedModuleSchema } from "./analysis.schemas";
import { calculateReviewScore } from "./scoring";

describe("calculateReviewScore", () => {
  it("uses the 30/25/25/20 base weights for all completed modules", () => {
    const result = calculateReviewScore([
      completedModule("brief_fit", { issues: [issue("brief_fit", "minor")] }),
      completedModule("evidence_citations", {
        issues: [issue("evidence_citations", "critical")],
      }),
      completedModule("editorial_quality", {
        issues: [issue("editorial_quality", "major")],
      }),
      completedModule("ai_risk", { aiRisk: "low" }),
    ]);

    expect(result).toEqual({
      overall: 90,
      dimensions: {
        brief_fit: 97,
        evidence_citations: 75,
        editorial_quality: 90,
        ai_risk: 100,
      },
      normalizedWeights: {
        brief_fit: 0.3,
        evidence_citations: 0.25,
        editorial_quality: 0.25,
        ai_risk: 0.2,
      },
    });
  });

  it.each([
    ["critical", 75],
    ["major", 90],
    ["minor", 97],
  ] as const)("applies the %s issue penalty", (severity, expectedDimension) => {
    const result = calculateReviewScore([
      completedModule("brief_fit", { issues: [issue("brief_fit", severity)] }),
      completedModule("evidence_citations"),
    ]);

    expect(result?.dimensions.brief_fit).toBe(expectedDimension);
  });

  it("floors a non-AI dimension at zero", () => {
    const result = calculateReviewScore([
      completedModule("brief_fit", {
        issues: [
          issue("brief_fit", "critical"),
          issue("brief_fit", "critical"),
          issue("brief_fit", "critical"),
          issue("brief_fit", "critical"),
          issue("brief_fit", "critical"),
        ],
      }),
      completedModule("evidence_citations"),
    ]);

    expect(result?.dimensions.brief_fit).toBe(0);
  });

  it("maps AI risk levels to their dimension scores", () => {
    const expectedDimensions = { low: 100, medium: 70, high: 40 } as const;

    for (const [aiRisk, expectedDimension] of Object.entries(expectedDimensions)) {
      const result = calculateReviewScore([
        completedModule("evidence_citations"),
        completedModule("ai_risk", {
          aiRisk: aiRisk as keyof typeof expectedDimensions,
        }),
      ]);

      expect(result?.dimensions.ai_risk).toBe(expectedDimension);
    }
  });

  it("normalizes weights when brief_fit is unavailable", () => {
    const result = calculateReviewScore([
      completedModule("evidence_citations", {
        issues: [issue("evidence_citations", "major"), issue("evidence_citations", "minor")],
      }),
      completedModule("editorial_quality", {
        issues: [issue("editorial_quality", "major")],
      }),
    ]);

    expect(result).toEqual({
      overall: 89,
      dimensions: { evidence_citations: 87, editorial_quality: 90 },
      normalizedWeights: { evidence_citations: 0.5, editorial_quality: 0.5 },
    });
  });

  it("normalizes weights when a non-brief module is unavailable", () => {
    const result = calculateReviewScore([
      completedModule("brief_fit"),
      completedModule("evidence_citations", {
        issues: [issue("evidence_citations", "major")],
      }),
      completedModule("ai_risk", { aiRisk: "high" }),
    ]);

    expect(result).toEqual({
      overall: 81,
      dimensions: { brief_fit: 100, evidence_citations: 90, ai_risk: 40 },
      normalizedWeights: {
        brief_fit: 0.4,
        evidence_citations: 1 / 3,
        ai_risk: 4 / 15,
      },
    });
  });

  it("returns null with fewer than two completed modules", () => {
    expect(calculateReviewScore([completedModule("brief_fit")])).toBeNull();
  });

  it("rejects duplicate completed modules before scoring", () => {
    expect(() =>
      calculateReviewScore([
        completedModule("brief_fit"),
        completedModule("brief_fit"),
        completedModule("evidence_citations"),
      ]),
    ).toThrow(new RangeError("Duplicate completed module: brief_fit"));
  });
});

describe("completedModuleSchema", () => {
  it("requires AI risk only for the AI-risk module and matches issue modules", () => {
    expect(
      completedModuleSchema.safeParse({
        module: "ai_risk",
        issues: [],
      }).success,
    ).toBe(false);
    expect(
      completedModuleSchema.safeParse({
        module: "brief_fit",
        aiRisk: "low",
        issues: [],
      }).success,
    ).toBe(false);
    expect(
      completedModuleSchema.safeParse({
        module: "brief_fit",
        issues: [issue("editorial_quality", "minor")],
      }).success,
    ).toBe(false);
  });
});
