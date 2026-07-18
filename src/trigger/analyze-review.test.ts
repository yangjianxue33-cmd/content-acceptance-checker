// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { createAnalyzeReviewRun } from "./analyze-review";

const reviewId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

describe("analyze-review task", () => {
  test("accepts only reviewId, runs independent modules, and finalizes", async () => {
    const runModules = vi.fn().mockResolvedValue([
      "complete",
      "complete",
      "complete",
      "not_assessed",
    ]);
    const finalize = vi.fn().mockResolvedValue({ status: "completed" });
    const run = createAnalyzeReviewRun({ runModules, finalize });

    await expect(run({ reviewId })).resolves.toEqual({ status: "completed" });

    expect(runModules).toHaveBeenCalledWith(reviewId);
    expect(finalize).toHaveBeenCalledWith(reviewId);
  });

  test("rejects extra payload fields before running", async () => {
    const runModules = vi.fn();
    const run = createAnalyzeReviewRun({ runModules, finalize: vi.fn() });

    await expect(run({ reviewId, articleText: "PRIVATE" })).rejects.toThrow(
      "Invalid analysis task payload",
    );
    expect(runModules).not.toHaveBeenCalled();
  });
});
