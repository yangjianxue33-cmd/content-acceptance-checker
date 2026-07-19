import { expect, test } from "@playwright/test";

import {
  FAKE_SCENARIOS,
  openReport,
  submitReview,
} from "./fixtures/fake-analysis";

test("AT-07 a provider failure preserves a scored partial report", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.partialFailure,
    wordCount: 400,
  });
  await expect(page.getByRole("heading", { name: /Report ready with one unavailable check/ })).toBeVisible();
  await openReport(page);

  await expect(page.getByText("Partial", { exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Normalized score")).not.toContainText("Not available");
});

test("AT-08 fewer than two completed modules shows no score and permits retry", async ({ page }) => {
  await submitReview(page, {
    marker: FAKE_SCENARIOS.totalFailure,
    wordCount: 400,
  });
  await expect(page.getByRole("heading", { name: "Analysis needs another attempt." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry analysis" })).toBeVisible();
  await openReport(page);

  await expect(page.getByLabel("Normalized score")).toContainText("Not available");
  await expect(page.getByLabel("System recommendation")).toContainText("Not available");
  await expect(page.getByText(/too few completed checks/i)).toBeVisible();
});
