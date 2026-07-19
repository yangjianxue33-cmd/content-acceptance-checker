import { expect, test } from "@playwright/test";

import {
  confirmBrief,
  FAKE_SCENARIOS,
  openReport,
  submitReview,
} from "./fixtures/fake-analysis";

test("AT-01, AT-03, AT-22 paste, confirm, report, and record a decision", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.standard,
    wordCount: 1_500,
    brief: "Audience: engineering leaders. Include practical evidence.",
  });
  await confirmBrief(page);
  await openReport(page);

  await expect(page.locator(".report-module-card")).toHaveCount(4);
  await expect(page.locator(".issue-item")).toHaveCount(0);
  await expect(page.getByText("Editorial advisory")).toBeVisible();
  await expect(
    page.getByText(/Results are advisory, do not prove authorship/),
  ).toBeVisible();

  await page.getByLabel("Ready").check();
  await page.getByRole("button", { name: "Save editor decision" }).click();
  await expect(page.getByText("Editor decision saved.")).toBeVisible();
});

test("AT-02, AT-04 upload without a brief reweights available modules", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.standard,
    wordCount: 120,
    upload: true,
  });
  await openReport(page);

  const briefCard = page.locator(".report-module-card").filter({ hasText: "Brief fit" });
  const riskCard = page.locator(".report-module-card").filter({ hasText: "AI-writing risk" });
  await expect(briefCard).toContainText("Not assessed");
  await expect(riskCard).toContainText("Not assessed");
  await expect(page.getByText("No confirmed brief requirements were supplied.")).toBeVisible();
  await expect(page.getByLabel("Normalized score")).not.toContainText("Not available");
});

test("AT-05 high AI-writing risk remains advisory and requires manual review", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.highRisk,
    wordCount: 400,
  });
  await openReport(page);

  await expect(page.getByLabel("System recommendation")).toContainText(
    "Manual review required",
  );
  await expect(page.getByText("High — manual review")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\b(?:Reject|Cheating|Guilt)\b/i);
});

test("AT-06 a missing confirmed critical requirement requests revisions", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.criticalMissing,
    wordCount: 400,
    brief: "Audience: engineering leaders. This requirement is mandatory.",
  });
  await expect(page.getByLabel("Requirement 1 is critical")).toBeChecked();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await openReport(page);

  await expect(page.getByLabel("System recommendation")).toContainText(
    "Request revisions",
  );
  await expect(page.getByRole("region", { name: "Critical issues" })).toBeVisible();
});
