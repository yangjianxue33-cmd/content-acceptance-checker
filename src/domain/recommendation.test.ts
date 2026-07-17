import { describe, expect, it } from "vitest";

import { issue } from "@/test/fixtures/module-results";

import { recommendAction } from "./recommendation";

describe("recommendAction", () => {
  it("requires manual review when fewer than two modules are available", () => {
    expect(
      recommendAction({ issues: [], aiRisk: "low", availableModuleCount: 1 }),
    ).toBe("manual_review_required");
  });

  it("requires manual review for high AI risk before issue severity", () => {
    expect(
      recommendAction({
        issues: [issue("brief_fit", "critical")],
        aiRisk: "high",
        availableModuleCount: 4,
      }),
    ).toBe("manual_review_required");
  });

  it("does not reject based on high AI risk alone", () => {
    expect(
      recommendAction({ issues: [], aiRisk: "high", availableModuleCount: 4 }),
    ).toBe("manual_review_required");
  });

  it.each(["critical", "major"] as const)(
    "requests revisions for a %s issue",
    (severity) => {
      expect(
        recommendAction({
          issues: [issue("brief_fit", severity)],
          aiRisk: "low",
          availableModuleCount: 4,
        }),
      ).toBe("request_revisions");
    },
  );

  it("is ready to approve after clean completed checks", () => {
    expect(
      recommendAction({ issues: [], aiRisk: "low", availableModuleCount: 4 }),
    ).toBe("ready_to_approve");
  });

  it("does not require manual review for not-assessed AI risk with two modules", () => {
    expect(
      recommendAction({
        issues: [],
        aiRisk: "not_assessed",
        availableModuleCount: 2,
      }),
    ).toBe("ready_to_approve");
  });
});
