export type ReviewRetentionRecord = {
  id: string;
  deleteAt: string;
  objectPaths: string[];
};

export type StoredReviewObject = {
  name: string;
  createdAt: string;
};

export type ReviewCleanupDependencies = {
  now?: () => Date;
  repository: {
    listRetentionCandidates(input: {
      before: string;
      limit: number;
    }): Promise<ReviewRetentionRecord[]>;
    reviewExists(reviewId: string): Promise<boolean>;
    deleteReview(reviewId: string): Promise<void>;
  };
  storage: {
    remove(paths: string[]): Promise<void>;
    list(input: {
      cursor: string | null;
      limit: number;
    }): Promise<{
      objects: StoredReviewObject[];
      nextCursor: string | null;
    }>;
  };
};

export type ReviewCleanupOptions = {
  expiredReviewLimit?: number;
  orphanPageSize?: number;
  maxOrphanPages?: number;
};

export type ReviewCleanupResult = {
  expiredReviewsDeleted: number;
  expiredObjectsDeleted: number;
  orphanObjectsDeleted: number;
  failures: number;
};

const DEFAULT_EXPIRED_REVIEW_LIMIT = 100;
const DEFAULT_ORPHAN_PAGE_SIZE = 100;
const DEFAULT_MAX_ORPHAN_PAGES = 10;
const ORPHAN_MINIMUM_AGE_MS = 25 * 60 * 60 * 1_000;
const UUID_PREFIX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\//i;

function boundedInteger(value: number | undefined, fallback: number) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return fallback;
  return value as number;
}

function isDue(record: ReviewRetentionRecord, nowMs: number) {
  const deleteAt = new Date(record.deleteAt).getTime();
  return Number.isFinite(deleteAt) && deleteAt <= nowMs;
}

function oldOrphanReviewId(object: StoredReviewObject, cutoffMs: number) {
  const match = UUID_PREFIX.exec(object.name);
  if (!match) return null;

  const createdAt = new Date(object.createdAt).getTime();
  if (!Number.isFinite(createdAt) || createdAt > cutoffMs) return null;
  return match[1].toLowerCase();
}

export async function deleteExpiredReviews(
  dependencies: ReviewCleanupDependencies,
  options: ReviewCleanupOptions = {},
): Promise<ReviewCleanupResult> {
  const now = (dependencies.now ?? (() => new Date()))();
  const nowMs = now.getTime();
  const result: ReviewCleanupResult = {
    expiredReviewsDeleted: 0,
    expiredObjectsDeleted: 0,
    orphanObjectsDeleted: 0,
    failures: 0,
  };

  const candidates = await dependencies.repository.listRetentionCandidates({
    before: now.toISOString(),
    limit: boundedInteger(
      options.expiredReviewLimit,
      DEFAULT_EXPIRED_REVIEW_LIMIT,
    ),
  });

  for (const review of candidates) {
    if (!isDue(review, nowMs)) continue;
    try {
      if (review.objectPaths.length > 0) {
        await dependencies.storage.remove(review.objectPaths);
        result.expiredObjectsDeleted += review.objectPaths.length;
      }
      await dependencies.repository.deleteReview(review.id);
      result.expiredReviewsDeleted += 1;
    } catch {
      result.failures += 1;
    }
  }

  const orphanPageSize = boundedInteger(
    options.orphanPageSize,
    DEFAULT_ORPHAN_PAGE_SIZE,
  );
  const maxOrphanPages = boundedInteger(
    options.maxOrphanPages,
    DEFAULT_MAX_ORPHAN_PAGES,
  );
  const orphanCutoffMs = nowMs - ORPHAN_MINIMUM_AGE_MS;
  let cursor: string | null = null;

  for (let page = 0; page < maxOrphanPages; page += 1) {
    let listing: Awaited<ReturnType<typeof dependencies.storage.list>>;
    try {
      listing = await dependencies.storage.list({
        cursor,
        limit: orphanPageSize,
      });
    } catch {
      result.failures += 1;
      break;
    }

    for (const object of listing.objects) {
      const reviewId = oldOrphanReviewId(object, orphanCutoffMs);
      if (!reviewId) continue;

      try {
        if (await dependencies.repository.reviewExists(reviewId)) continue;
        await dependencies.storage.remove([object.name]);
        result.orphanObjectsDeleted += 1;
      } catch {
        result.failures += 1;
      }
    }

    if (!listing.nextCursor) break;
    cursor = listing.nextCursor;
  }

  return result;
}

export async function createProductionReviewCleanupDependencies(): Promise<ReviewCleanupDependencies> {
  const { createClient } = await import("@/server/supabase/admin");
  const client = createClient();
  const bucket = client.storage.from("review-source");

  return {
    repository: {
      async listRetentionCandidates({ before, limit }) {
        const { data: reviews, error: reviewError } = await client
          .from("reviews")
          .select("id, delete_at")
          .lte("delete_at", before)
          .order("delete_at", { ascending: true })
          .limit(limit);
        if (reviewError) throw new Error("retention_candidates_failed");
        if (!reviews || reviews.length === 0) return [];

        const reviewIds = reviews.map((review) => review.id);
        const { data: files, error: fileError } = await client
          .from("review_files")
          .select("review_id, object_path")
          .in("review_id", reviewIds);
        if (fileError) throw new Error("retention_files_failed");

        const pathsByReview = new Map<string, string[]>();
        for (const file of files ?? []) {
          const paths = pathsByReview.get(file.review_id) ?? [];
          paths.push(file.object_path);
          pathsByReview.set(file.review_id, paths);
        }

        return reviews.map((review) => ({
          id: review.id,
          deleteAt: review.delete_at,
          objectPaths: pathsByReview.get(review.id) ?? [],
        }));
      },
      async reviewExists(reviewId) {
        const { data, error } = await client
          .from("reviews")
          .select("id")
          .eq("id", reviewId)
          .maybeSingle();
        if (error) throw new Error("retention_review_lookup_failed");
        return data !== null;
      },
      async deleteReview(reviewId) {
        const { error } = await client.from("reviews").delete().eq("id", reviewId);
        if (error) throw new Error("retention_row_delete_failed");
      },
    },
    storage: {
      async remove(paths) {
        const { error } = await bucket.remove(paths);
        if (error) throw new Error("retention_storage_delete_failed");
      },
      async list({ cursor, limit }) {
        const { data, error } = await bucket.listV2({
          cursor: cursor ?? undefined,
          limit,
          with_delimiter: false,
          sortBy: { column: "name", order: "asc" },
        });
        if (error || !data) throw new Error("retention_storage_list_failed");

        return {
          objects: data.objects.map((object) => ({
            name: object.key ?? object.name,
            createdAt: object.created_at,
          })),
          nextCursor: data.hasNext ? (data.nextCursor ?? null) : null,
        };
      },
    },
  };
}

export async function deleteExpiredProductionReviews() {
  return deleteExpiredReviews(await createProductionReviewCleanupDependencies());
}
