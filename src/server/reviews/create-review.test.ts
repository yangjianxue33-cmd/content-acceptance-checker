// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, test, vi } from "vitest";

import {
  createReviewsPostHandler,
  uploadedDocument,
} from "@/app/api/reviews/route";
import type { UploadedDocument } from "@/server/documents/contracts";
import { DocumentExtractionError } from "@/server/documents/extract-text";
import {
  createAnonymousReview,
  CreateReviewError,
  type ReviewCreationRecord,
  type ReviewCreationStorage,
} from "./create-review";

const reviewId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-18T08:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 17).toString("base64");

function words(count: number) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

function createHarness(
  options: { repositoryFailure?: Error; removalFailures?: number } = {},
) {
  const uploads: Parameters<ReviewCreationStorage["upload"]>[0][] = [];
  const removals: string[][] = [];
  const persisted: ReviewCreationRecord[] = [];
  const storage: ReviewCreationStorage = {
    async upload(object) {
      uploads.push(object);
    },
    async remove(paths) {
      removals.push([...paths]);
      if (removals.length <= (options.removalFailures ?? 0)) {
        throw new Error("cleanup_failed");
      }
    },
  };
  const dependencies = {
    storage,
    repository: {
      async create(record: ReviewCreationRecord) {
        if (options.repositoryFailure) {
          throw options.repositoryFailure;
        }
        persisted.push(record);
      },
    },
    createId: () => reviewId,
    now: () => now,
    createToken: () => "raw-access-token",
    tokenHashSecret: "t".repeat(32),
    sourceTextEncryptionKey: encryptionKey,
  };

  return { dependencies, persisted, removals, uploads };
}

function uploadedTxt(): UploadedDocument {
  const bytes = Buffer.from("Uploaded article text for an editorial review.");
  return {
    name: "client-handoff.txt",
    type: "text/plain",
    size: bytes.byteLength,
    bytes,
  };
}

describe("createAnonymousReview", () => {
  test("creates a pasted-text review without uploading the article", async () => {
    const harness = createHarness();

    const result = await createAnonymousReview(
      {
        bodyText: "Agency handoff title\n\nA concise article body for review.",
        contentType: "blog_post",
      },
      harness.dependencies,
    );

    expect(result).toEqual({
      reviewId,
      accessToken: "raw-access-token",
      nextPath: `/review/progress/${reviewId}`,
      aiRiskEligible: false,
    });
    expect(harness.uploads).toEqual([]);
    expect(harness.persisted[0]).toMatchObject({
      id: reviewId,
      title: "Agency handoff title",
      contentType: "blog_post",
      sourceInputType: "pasted_text",
      briefPresent: false,
      status: "queued",
      files: [],
    });
  });

  test("extracts and privately uploads a supported source file under the review UUID", async () => {
    const harness = createHarness();
    const extractText = vi.fn().mockResolvedValue("Uploaded article heading\n\nBody.");

    await createAnonymousReview(
      {
        file: uploadedTxt(),
        contentType: "seo_article",
      },
      { ...harness.dependencies, extractText },
    );

    expect(extractText).toHaveBeenCalledWith(uploadedTxt());
    expect(harness.uploads).toHaveLength(1);
    expect(harness.uploads[0]).toMatchObject({
      path: `${reviewId}/source.txt`,
      contentType: "text/plain",
    });
    expect(harness.persisted[0]).toMatchObject({
      title: "client-handoff",
      sourceInputType: "uploaded_file",
      originalFilename: "client-handoff.txt",
      files: [
        {
          fileKind: "source",
          objectPath: `${reviewId}/source.txt`,
          originalFilename: "client-handoff.txt",
          mimeType: "text/plain",
        },
      ],
    });
  });

  test("rejects both article sources before any external write", async () => {
    const harness = createHarness();

    await expect(
      createAnonymousReview(
        {
          bodyText: "Pasted article",
          file: uploadedTxt(),
          contentType: "other",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "article_source_count",
    });
    expect(harness.uploads).toEqual([]);
    expect(harness.persisted).toEqual([]);
  });

  test("requires an explicit supported content type", async () => {
    const harness = createHarness();

    await expect(
      createAnonymousReview(
        { bodyText: "Pasted article", contentType: "" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "invalid_content_type",
    });
  });

  test("stores an optional normalized brief privately and routes to confirmation", async () => {
    const harness = createHarness();

    const result = await createAnonymousReview(
      {
        bodyText: "Article title\n\nArticle body.",
        briefText: "  Include   a customer example.  ",
        contentType: "thought_leadership",
      },
      harness.dependencies,
    );

    expect(result.nextPath).toBe(
      `/review/brief-confirmation?reviewId=${reviewId}`,
    );
    expect(harness.uploads).toHaveLength(1);
    expect(harness.uploads[0]).toMatchObject({
      path: `${reviewId}/brief.txt`,
      contentType: "text/plain",
    });
    expect(Buffer.from(harness.uploads[0].bytes).toString("utf8")).toBe(
      "Include a customer example.",
    );
    expect(harness.persisted[0]).toMatchObject({
      briefPresent: true,
      status: "awaiting_brief_confirmation",
      files: [
        {
          fileKind: "brief",
          objectPath: `${reviewId}/brief.txt`,
          mimeType: "text/plain",
        },
      ],
    });
  });

  test("sets anonymous retention to exactly 24 hours", async () => {
    const harness = createHarness();

    await createAnonymousReview(
      { bodyText: words(300), contentType: "other" },
      harness.dependencies,
    );

    expect(harness.persisted[0].deleteAt).toBe("2026-07-19T08:00:00.000Z");
  });

  test("accepts under-300-word text but marks AI risk ineligible", async () => {
    const harness = createHarness();

    const result = await createAnonymousReview(
      { bodyText: words(299), contentType: "other" },
      harness.dependencies,
    );

    expect(result.aiRiskEligible).toBe(false);
    expect(harness.persisted).toHaveLength(1);
  });

  test("rejects pasted text over 5,000 words before persistence", async () => {
    const harness = createHarness();

    await expect(
      createAnonymousReview(
        { bodyText: words(5_001), contentType: "other" },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ code: "too_many_words" });
    expect(harness.persisted).toEqual([]);
  });

  test("persists only the token hash and encrypted article source", async () => {
    const harness = createHarness();
    const privateBody = "Private article source that must not remain in plaintext.";
    const article = `Editorial handoff title\n\n${privateBody}`;

    const result = await createAnonymousReview(
      { bodyText: article, contentType: "other" },
      harness.dependencies,
    );

    const serializedRecord = JSON.stringify(harness.persisted[0]);
    expect(serializedRecord).not.toContain(result.accessToken);
    expect(serializedRecord).not.toContain(privateBody);
    expect(harness.persisted[0].accessTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.persisted[0].sourceTextEncrypted).toBeInstanceOf(Buffer);
  });

  test("deletes every uploaded object when the transactional repository call fails", async () => {
    const harness = createHarness({ repositoryFailure: new Error("rpc_failed") });

    await expect(
      createAnonymousReview(
        {
          file: uploadedTxt(),
          briefText: "Customer brief",
          contentType: "other",
        },
        {
          ...harness.dependencies,
          extractText: async () => "Uploaded article body.",
        },
      ),
    ).rejects.toMatchObject({ code: "creation_failed" });

    expect(harness.removals).toEqual([
      [`${reviewId}/source.txt`, `${reviewId}/brief.txt`],
    ]);
  });

  test("retries compensating deletion three times before giving up", async () => {
    const harness = createHarness({
      repositoryFailure: new Error("rpc_failed"),
      removalFailures: 3,
    });

    await expect(
      createAnonymousReview(
        { file: uploadedTxt(), contentType: "other" },
        {
          ...harness.dependencies,
          extractText: async () => "Uploaded article body.",
        },
      ),
    ).rejects.toMatchObject({ code: "creation_failed" });

    expect(harness.removals).toHaveLength(3);
  });
});

describe("POST /api/reviews", () => {
  test("returns only the public creation DTO and a secure anonymous-access cookie", async () => {
    const createReview = vi.fn().mockResolvedValue({
      reviewId,
      accessToken: "raw-access-token",
      nextPath: `/review/progress/${reviewId}`,
      aiRiskEligible: false,
    });
    const handler = createReviewsPostHandler({ createReview });
    const formData = new FormData();
    formData.set("bodyText", "Article body");
    formData.set("briefText", "");
    formData.set("contentType", "blog_post");

    const response = await handler(
      new Request("https://checker.example/api/reviews", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      reviewId,
      accessToken: "raw-access-token",
      nextPath: `/review/progress/${reviewId}`,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "anonymous_review_access=raw-access-token",
    );
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(response.headers.get("set-cookie")).toMatch(/Path=\//i);
  });

  test("returns a safe 400 response for document validation errors", async () => {
    const handler = createReviewsPostHandler({
      createReview: vi.fn().mockRejectedValue(
        new DocumentExtractionError(
          "unsupported_file_type",
          "We can review PDF, DOCX, or TXT files.",
        ),
      ),
    });
    const formData = new FormData();
    formData.set("contentType", "other");
    formData.set("bodyText", "Article");

    const response = await handler(
      new Request("https://checker.example/api/reviews", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "unsupported_file_type",
      error: "We can review PDF, DOCX, or TXT files.",
    });
  });

  test("returns a generic 500 response for infrastructure creation failures", async () => {
    const handler = createReviewsPostHandler({
      createReview: vi.fn().mockRejectedValue(
        new CreateReviewError("creation_failed", "internal detail"),
      ),
    });
    const formData = new FormData();
    formData.set("contentType", "other");
    formData.set("bodyText", "Article");

    const response = await handler(
      new Request("https://checker.example/api/reviews", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "We couldn't create this review. Try again.",
    });
  });

  test("rejects oversized files before reading their bytes", async () => {
    const arrayBuffer = vi.fn();
    const oversized = new File(["x"], "large.txt", { type: "text/plain" });
    Object.defineProperties(oversized, {
      size: { value: 10 * 1024 * 1024 + 1 },
      arrayBuffer: { value: arrayBuffer },
    });

    await expect(uploadedDocument(oversized)).rejects.toMatchObject({
      code: "file_too_large",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
