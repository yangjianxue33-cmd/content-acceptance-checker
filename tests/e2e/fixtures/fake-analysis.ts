import { expect, type Page } from "@playwright/test";

export const FAKE_SCENARIOS = {
  standard: "E2E_STANDARD",
  highRisk: "E2E_HIGH_AI_RISK",
  criticalMissing: "E2E_CRITICAL_MISSING",
  partialFailure: "E2E_PARTIAL_FAILURE",
  totalFailure: "E2E_TOTAL_FAILURE",
  injection: "E2E_INJECTION",
} as const;

export function articleFixture(marker: string, wordCount = 350) {
  const words = [marker, "Editorial", "review"];
  while (words.length < wordCount) words.push(`word${words.length}`);
  return words.join(" ");
}

export async function submitReview(
  page: Page,
  options: {
    marker: string;
    wordCount?: number;
    brief?: string;
    upload?: boolean;
  },
) {
  const article = articleFixture(options.marker, options.wordCount);
  await page.goto("/review");

  if (options.upload) {
    await page.getByRole("tab", { name: "Upload file" }).click();
    await page.getByLabel("Choose article file").setInputFiles({
      name: "e2e-article.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(article, "utf8"),
    });
  } else {
    await page.getByLabel("Article text").fill(article);
  }
  await page.getByLabel("Blog post").check();

  if (options.brief) {
    await page.getByRole("button", { name: "Add a content brief" }).click();
    await page.getByLabel("Content brief").fill(options.brief);
  }

  await page.getByRole("button", { name: "Review content" }).click();
  await expect(page).toHaveURL(
    options.brief
      ? /\/review\/brief-confirmation\?reviewId=[0-9a-f-]+$/
      : /\/review\/progress\/[0-9a-f-]+$/,
  );
  const url = new URL(page.url());
  const reviewId =
    url.searchParams.get("reviewId") ?? url.pathname.split("/").at(-1);
  if (!reviewId) throw new Error("Review id missing from navigation");
  return { reviewId, article };
}

export async function confirmBrief(page: Page) {
  await expect(page.getByRole("heading", { name: "Set the acceptance line." })).toBeVisible();
  await page
    .getByLabel("Requirement 1 text")
    .fill("Address senior engineering leaders with practical guidance");
  await page.getByLabel("Requirement 1 is critical").uncheck();
  await page.getByRole("button", { name: "Add requirement" }).click();
  await page.getByLabel("Requirement 2 category").fill("Evidence");
  await page.getByLabel("Requirement 2 text").fill("Include grounded evidence");
  await page.getByRole("button", { name: "Delete requirement 2" }).click();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await expect(page).toHaveURL(/\/review\/progress\/[0-9a-f-]+$/);
}

export async function openReport(page: Page) {
  const link = page.getByRole("link", { name: "Open review report" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/report\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Module results" })).toBeVisible();
}
