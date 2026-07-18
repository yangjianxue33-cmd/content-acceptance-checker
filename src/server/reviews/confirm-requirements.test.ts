// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, test, vi } from "vitest";

import { createRequirementsRouteHandlers } from "@/app/api/reviews/[id]/requirements/route";
import { encryptSourceText } from "@/server/security/source-text-encryption";
import { hashAccessToken } from "@/server/security/token";
import {
  confirmRequirements,
  loadRequirementsForConfirmation,
  RequirementsAccessError,
  RequirementsLoadError,
  RequirementsValidationError,
} from "./confirm-requirements";

const reviewId = "11111111-1111-4111-8111-111111111111";
const accessToken = "anonymous-cookie-token";
const tokenHashSecret = "t".repeat(32);
const encryptionKey = Buffer.alloc(32, 23).toString("base64");
const now = new Date("2026-07-18T08:00:00.000Z");

const extracted = {
  category: "Evidence",
  text: "Include a named customer example.",
  isCritical: true,
  sourceExcerpt: "Include a named customer example.",
};

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: reviewId,
    anonymousAccessTokenHash: hashAccessToken(accessToken, tokenHashSecret),
    deleteAt: "2026-07-19T08:00:00.000Z",
    briefPresent: true,
    status: "awaiting_brief_confirmation" as const,
    sourceTextEncrypted: encryptSourceText("PRIVATE ARTICLE", encryptionKey),
    briefObjectPath: `${reviewId}/brief.txt`,
    requirements: [],
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const replace = vi.fn().mockResolvedValue("awaiting_brief_confirmation");
  const load = vi.fn().mockResolvedValue(review());
  const downloadBrief = vi.fn().mockResolvedValue("PRIVATE BRIEF");
  const extractBrief = vi.fn().mockResolvedValue([extracted]);
  return {
    dependencies: {
      repository: { load, replace },
      storage: { downloadBrief },
      analyzer: { extractBrief },
      tokenHashSecret,
      sourceTextEncryptionKey: encryptionKey,
      now: () => now,
      ...overrides,
    },
    downloadBrief,
    extractBrief,
    load,
    replace,
  };
}

describe("loadRequirementsForConfirmation", () => {
  test("verifies cookie ownership, decrypts private source, and persists extraction before returning", async () => {
    const setup = harness();

    const result = await loadRequirementsForConfirmation(
      { reviewId, accessToken },
      setup.dependencies,
    );

    expect(setup.downloadBrief).toHaveBeenCalledWith(`${reviewId}/brief.txt`);
    expect(setup.extractBrief).toHaveBeenCalledWith({
      articleText: "PRIVATE ARTICLE",
      briefText: "PRIVATE BRIEF",
    });
    expect(setup.replace).toHaveBeenCalledWith(reviewId, [extracted], false);
    expect(result).toEqual({
      kind: "editor",
      reviewId,
      requirements: [extracted],
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE ARTICLE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE BRIEF");
  });

  test("reuses a persisted draft without decrypting or invoking the provider", async () => {
    const draft = { id: "req-1", ...extracted };
    const setup = harness();
    setup.load.mockResolvedValue(review({ requirements: [draft] }));

    const result = await loadRequirementsForConfirmation(
      { reviewId, accessToken },
      setup.dependencies,
    );

    expect(result).toEqual({
      kind: "editor",
      reviewId,
      requirements: [draft],
    });
    expect(setup.downloadBrief).not.toHaveBeenCalled();
    expect(setup.extractBrief).not.toHaveBeenCalled();
    expect(setup.replace).not.toHaveBeenCalled();
  });

  test("skips a no-brief review without creating requirements or invoking OpenAI", async () => {
    const setup = harness();
    setup.load.mockResolvedValue(
      review({
        briefPresent: false,
        status: "queued",
        briefObjectPath: null,
        sourceTextEncrypted: null,
      }),
    );

    await expect(
      loadRequirementsForConfirmation(
        { reviewId, accessToken },
        setup.dependencies,
      ),
    ).resolves.toEqual({
      kind: "redirect",
      nextPath: `/review/progress/${reviewId}`,
    });
    expect(setup.downloadBrief).not.toHaveBeenCalled();
    expect(setup.extractBrief).not.toHaveBeenCalled();
    expect(setup.replace).not.toHaveBeenCalled();
  });

  test.each([
    ["missing cookie", null, {}],
    ["wrong cookie", "wrong-token", {}],
    ["missing review", accessToken, { missing: true }],
    [
      "expired review",
      accessToken,
      { reviewOverrides: { deleteAt: "2026-07-18T07:59:59.000Z" } },
    ],
  ])("treats %s uniformly as not found", async (_caseName, token, options) => {
    const setup = harness();
    if ("missing" in options && options.missing) {
      setup.load.mockResolvedValue(null);
    }
    if ("reviewOverrides" in options) {
      setup.load.mockResolvedValue(review(options.reviewOverrides));
    }

    const promise = loadRequirementsForConfirmation(
      { reviewId, accessToken: token },
      setup.dependencies,
    );

    await expect(promise).rejects.toBeInstanceOf(RequirementsAccessError);
    await expect(promise).rejects.toMatchObject({
      code: "not_found",
      message: "Review not found",
    });
    expect(setup.downloadBrief).not.toHaveBeenCalled();
    expect(setup.extractBrief).not.toHaveBeenCalled();
  });

  test("returns a generic load failure when the private brief cannot be downloaded", async () => {
    const setup = harness();
    setup.downloadBrief.mockRejectedValue(
      new Error("storage leaked PRIVATE BRIEF path"),
    );

    const promise = loadRequirementsForConfirmation(
      { reviewId, accessToken },
      setup.dependencies,
    );

    await expect(promise).rejects.toBeInstanceOf(RequirementsLoadError);
    await expect(promise).rejects.toMatchObject({
      code: "source_unavailable",
      message: "Requirements could not be loaded",
    });
    expect(setup.extractBrief).not.toHaveBeenCalled();
  });
});

describe("confirmRequirements", () => {
  test("atomically submits added, edited, deleted, and critical-toggle state", async () => {
    const setup = harness();
    const editedRequirements = [
      {
        category: "Audience and voice",
        text: "Write for operations leaders.",
        isCritical: false,
        sourceExcerpt: "Write for operations leaders.",
      },
      {
        category: "Added by editor",
        text: "End with a concrete next step.",
        isCritical: true,
        sourceExcerpt: null,
      },
    ];
    setup.replace.mockResolvedValue("queued");

    await expect(
      confirmRequirements(
        { reviewId, accessToken, requirements: editedRequirements },
        setup.dependencies,
      ),
    ).resolves.toEqual({ nextPath: `/review/progress/${reviewId}` });

    expect(setup.replace).toHaveBeenCalledWith(
      reviewId,
      editedRequirements,
      true,
    );
  });

  test("keeps the first confirmed set when a divergent repeat arrives", async () => {
    let status: "awaiting_brief_confirmation" | "queued" =
      "awaiting_brief_confirmation";
    let persisted: unknown[] = [];
    const setup = harness({
      repository: {
        load: vi.fn().mockImplementation(async () => review({ status })),
        replace: vi.fn().mockImplementation(async (
          _id: string,
          requirements: unknown[],
          confirm: boolean,
        ) => {
          if (confirm && status === "awaiting_brief_confirmation") {
            persisted = requirements;
            status = "queued";
          }
          return status;
        }),
      },
    });
    const first = [{ ...extracted, text: "First accepted version" }];
    const divergent = [{ ...extracted, text: "Divergent retry" }];

    await confirmRequirements(
      { reviewId, accessToken, requirements: first },
      setup.dependencies,
    );
    await confirmRequirements(
      { reviewId, accessToken, requirements: divergent },
      setup.dependencies,
    );

    expect(persisted).toEqual(first);
  });
});

describe("GET and PUT /api/reviews/:id/requirements", () => {
  const context = { params: Promise.resolve({ id: reviewId }) };

  test("GET reads the HttpOnly access cookie server-side and returns only editor data", async () => {
    const load = vi.fn().mockResolvedValue({
      kind: "editor",
      reviewId,
      requirements: [extracted],
    });
    const { GET } = createRequirementsRouteHandlers({
      load,
      confirm: vi.fn(),
    });

    const response = await GET(
      new Request(`https://checker.example/api/reviews/${reviewId}/requirements`, {
        headers: { Cookie: `anonymous_review_access=${accessToken}` },
      }),
      context,
    );

    expect(load).toHaveBeenCalledWith({ reviewId, accessToken });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reviewId,
      requirements: [extracted],
    });
  });

  test("GET maps missing, expired, or wrong ownership to the same not-found response", async () => {
    const load = vi.fn().mockRejectedValue(new RequirementsAccessError());
    const { GET } = createRequirementsRouteHandlers({
      load,
      confirm: vi.fn(),
    });

    const response = await GET(
      new Request(`https://checker.example/api/reviews/${reviewId}/requirements`),
      context,
    );

    expect(load).toHaveBeenCalledWith({ reviewId, accessToken: null });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Review not found" });
  });

  test("GET does not expose private source or provider failure details", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new RequirementsLoadError("source_unavailable"));
    const { GET } = createRequirementsRouteHandlers({
      load,
      confirm: vi.fn(),
    });

    const response = await GET(
      new Request(`https://checker.example/api/reviews/${reviewId}/requirements`, {
        headers: { Cookie: `anonymous_review_access=${accessToken}` },
      }),
      context,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Requirements could not be loaded",
    });
  });

  test("PUT confirms the posted editor state and returns the progress path", async () => {
    const requirements = [{ ...extracted, isCritical: false }];
    const confirm = vi.fn().mockResolvedValue({
      nextPath: `/review/progress/${reviewId}`,
    });
    const { PUT } = createRequirementsRouteHandlers({
      load: vi.fn(),
      confirm,
    });

    const response = await PUT(
      new Request(`https://checker.example/api/reviews/${reviewId}/requirements`, {
        method: "PUT",
        headers: {
          Cookie: `anonymous_review_access=${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requirements }),
      }),
      context,
    );

    expect(confirm).toHaveBeenCalledWith({
      reviewId,
      accessToken,
      requirements,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nextPath: `/review/progress/${reviewId}`,
    });
  });

  test("PUT announces safe validation errors without echoing the submitted body", async () => {
    const confirm = vi.fn().mockRejectedValue(new RequirementsValidationError());
    const { PUT } = createRequirementsRouteHandlers({
      load: vi.fn(),
      confirm,
    });

    const response = await PUT(
      new Request(`https://checker.example/api/reviews/${reviewId}/requirements`, {
        method: "PUT",
        headers: {
          Cookie: `anonymous_review_access=${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requirements: [{ text: "PRIVATE BODY" }] }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Check each requirement and try again." });
    expect(JSON.stringify(payload)).not.toContain("PRIVATE BODY");
  });
});
