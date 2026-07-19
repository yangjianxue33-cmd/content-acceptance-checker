import { describe, expect, it } from "vitest";

import {
  assertSafeFakeAnalysisEnvironment,
  isFakeAnalysisEnabled,
} from "@/server/security/fake-analysis-guard";

describe("fake analysis environment guard", () => {
  it("throws when fake analysis is enabled in production", () => {
    expect(() =>
      assertSafeFakeAnalysisEnvironment({
        nodeEnv: "production",
        fakeAnalysis: "true",
      }),
    ).toThrow("E2E_FAKE_ANALYSIS must never be enabled in production");
  });

  it("allows fake analysis only when explicitly enabled outside production", () => {
    expect(
      isFakeAnalysisEnabled({ nodeEnv: "test", fakeAnalysis: "true" }),
    ).toBe(true);
    expect(
      isFakeAnalysisEnabled({ nodeEnv: "development", fakeAnalysis: "false" }),
    ).toBe(false);
    expect(isFakeAnalysisEnabled({ nodeEnv: "test" })).toBe(false);
  });

  it("does not accept truthy variants", () => {
    expect(
      isFakeAnalysisEnabled({ nodeEnv: "test", fakeAnalysis: "TRUE" }),
    ).toBe(false);
    expect(
      isFakeAnalysisEnabled({ nodeEnv: "test", fakeAnalysis: "1" }),
    ).toBe(false);
  });
});
