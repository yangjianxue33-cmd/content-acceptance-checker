import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteExpiredReviews,
  type ReviewCleanupDependencies,
  type ReviewRetentionRecord,
  type StoredReviewObject,
} from "@/server/reviews/delete-expired";

const now = new Date("2026-07-19T12:00:00.000Z");
const expiredId = "550e8400-e29b-41d4-a716-446655440000";
const futureId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const orphanId = "123e4567-e89b-42d3-a456-426614174000";

function review(
  id: string,
  deleteAt: string,
  objectPaths: string[] = [],
): ReviewRetentionRecord {
  return { id, deleteAt, objectPaths };
}

function object(name: string, createdAt: string): StoredReviewObject {
  return { name, createdAt };
}

function harness(overrides: Partial<ReviewCleanupDependencies> = {}) {
  const reviews = new Map<string, ReviewRetentionRecord>();
  const stored = new Set<string>();
  const calls: string[] = [];

  const dependencies: ReviewCleanupDependencies = {
    now: () => now,
    repository: {
      async listRetentionCandidates() {
        return [...reviews.values()];
      },
      async reviewExists(reviewId) {
        return reviews.has(reviewId);
      },
      async deleteReview(reviewId) {
        calls.push(`row:${reviewId}`);
        reviews.delete(reviewId);
      },
    },
    storage: {
      async remove(paths) {
        calls.push(`storage:${paths.join(",")}`);
        paths.forEach((path) => stored.delete(path));
      },
      async list() {
        return { objects: [], nextCursor: null };
      },
    },
    ...overrides,
  };

  return { dependencies, reviews, stored, calls };
}

describe("deleteExpiredReviews", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deletes expired storage before its review row and retains future reviews", async () => {
    const h = harness();
    const path = `${expiredId}/source.txt`;
    h.reviews.set(
      expiredId,
      review(expiredId, "2026-07-19T11:59:59.000Z", [path]),
    );
    h.reviews.set(
      futureId,
      review(futureId, "2026-07-19T12:00:01.000Z", [`${futureId}/source.txt`]),
    );
    h.stored.add(path);

    const result = await deleteExpiredReviews(h.dependencies);

    expect(h.calls).toEqual([`storage:${path}`, `row:${expiredId}`]);
    expect(h.reviews.has(expiredId)).toBe(false);
    expect(h.reviews.has(futureId)).toBe(true);
    expect(result).toMatchObject({
      expiredReviewsDeleted: 1,
      expiredObjectsDeleted: 1,
      orphanObjectsDeleted: 0,
      failures: 0,
    });
  });

  it("keeps the row after storage failure and succeeds on the next idempotent run", async () => {
    const h = harness();
    const path = `${expiredId}/source.txt`;
    h.reviews.set(
      expiredId,
      review(expiredId, "2026-07-19T11:00:00.000Z", [path]),
    );
    h.stored.add(path);
    const remove = vi
      .fn<ReviewCleanupDependencies["storage"]["remove"]>()
      .mockRejectedValueOnce(new Error(`private payload ${path}`))
      .mockImplementation(async (paths) => {
        h.calls.push(`storage:${paths.join(",")}`);
        paths.forEach((item) => h.stored.delete(item));
      });
    h.dependencies.storage.remove = remove;

    const failed = await deleteExpiredReviews(h.dependencies);
    expect(failed.failures).toBe(1);
    expect(h.reviews.has(expiredId)).toBe(true);
    expect(h.calls).not.toContain(`row:${expiredId}`);

    const retried = await deleteExpiredReviews(h.dependencies);
    expect(retried.failures).toBe(0);
    expect(h.reviews.has(expiredId)).toBe(false);

    const repeated = await deleteExpiredReviews(h.dependencies);
    expect(repeated.expiredReviewsDeleted).toBe(0);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("paginates a bounded orphan sweep and deletes only old valid UUID-prefix objects", async () => {
    const h = harness();
    const knownId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
    h.reviews.set(
      knownId,
      review(knownId, "2026-07-20T12:00:00.000Z", [`${knownId}/known.txt`]),
    );
    const pages = [
      {
        objects: [
          object(`${orphanId}/old.txt`, "2026-07-18T10:59:59.000Z"),
          object(`${knownId}/known.txt`, "2026-07-18T10:00:00.000Z"),
          object("not-a-uuid/old.txt", "2026-07-18T10:00:00.000Z"),
          object(`${futureId}/young.txt`, "2026-07-18T11:00:01.000Z"),
        ],
        nextCursor: "page-2",
      },
      {
        objects: [
          object(`${expiredId}/second-old.txt`, "2026-07-17T10:00:00.000Z"),
        ],
        nextCursor: "page-3",
      },
      {
        objects: [object(`${futureId}/beyond-bound.txt`, "2026-07-17T10:00:00.000Z")],
        nextCursor: null,
      },
    ];
    const list = vi.fn(async ({ cursor }: { cursor: string | null; limit: number }) =>
      cursor === null ? pages[0] : cursor === "page-2" ? pages[1] : pages[2],
    );
    h.dependencies.storage.list = list;

    const result = await deleteExpiredReviews(h.dependencies, {
      orphanPageSize: 2,
      maxOrphanPages: 2,
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, { cursor: null, limit: 2 });
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "page-2", limit: 2 });
    expect(h.calls).toContain(`storage:${orphanId}/old.txt`);
    expect(h.calls).toContain(`storage:${expiredId}/second-old.txt`);
    expect(h.calls.join("\n")).not.toContain(`${knownId}/known.txt`);
    expect(h.calls.join("\n")).not.toContain("not-a-uuid/old.txt");
    expect(h.calls.join("\n")).not.toContain(`${futureId}/young.txt`);
    expect(h.calls.join("\n")).not.toContain("beyond-bound.txt");
    expect(result.orphanObjectsDeleted).toBe(2);
  });

  it("retains an orphan when storage deletion fails so a later sweep retries it", async () => {
    const h = harness();
    const orphanPath = `${orphanId}/old.txt`;
    h.dependencies.storage.list = vi.fn(async () => ({
      objects: [object(orphanPath, "2026-07-18T10:00:00.000Z")],
      nextCursor: null,
    }));
    h.dependencies.storage.remove = vi
      .fn<ReviewCleanupDependencies["storage"]["remove"]>()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);

    const failed = await deleteExpiredReviews(h.dependencies);
    const retried = await deleteExpiredReviews(h.dependencies);

    expect(failed).toMatchObject({ orphanObjectsDeleted: 0, failures: 1 });
    expect(retried).toMatchObject({ orphanObjectsDeleted: 1, failures: 0 });
    expect(h.dependencies.storage.remove).toHaveBeenCalledTimes(2);
  });
});
