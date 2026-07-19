import { createClient } from "@supabase/supabase-js";

import { deleteExpiredReviews } from "../../../src/server/reviews/delete-expired";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase E2E environment is missing");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function expireAndCleanReview(reviewId: string) {
  const client = adminClient();
  const { data: files, error: filesError } = await client
    .from("review_files")
    .select("object_path")
    .eq("review_id", reviewId);
  if (filesError) throw new Error("E2E retention file lookup failed");

  const { error: expireError } = await client
    .from("reviews")
    .update({ delete_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", reviewId);
  if (expireError) throw new Error("E2E retention expiry failed");

  const result = await deleteExpiredReviews({
    repository: {
      async listRetentionCandidates({ before, limit }) {
        const { data, error } = await client
          .from("reviews")
          .select("id, delete_at")
          .lte("delete_at", before)
          .limit(limit);
        if (error) throw new Error("E2E retention candidates failed");
        return (data ?? []).map((review) => ({
          id: review.id,
          deleteAt: review.delete_at,
          objectPaths:
            review.id === reviewId
              ? (files ?? []).map((file) => file.object_path)
              : [],
        }));
      },
      async reviewExists(id) {
        const { data, error } = await client
          .from("reviews")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("E2E retention lookup failed");
        return data !== null;
      },
      async deleteReview(id) {
        const { error } = await client.from("reviews").delete().eq("id", id);
        if (error) throw new Error("E2E retention row delete failed");
      },
    },
    storage: {
      async remove(paths) {
        const { error } = await client.storage.from("review-source").remove(paths);
        if (error) throw new Error("E2E retention storage delete failed");
      },
      async list() {
        return { objects: [], nextCursor: null };
      },
    },
  });

  const { data: review, error: reviewError } = await client
    .from("reviews")
    .select("id")
    .eq("id", reviewId)
    .maybeSingle();
  if (reviewError) throw new Error("E2E retention verification failed");
  const { data: remaining, error: storageError } = await client.storage
    .from("review-source")
    .list(reviewId);
  if (storageError) throw new Error("E2E retention storage verification failed");

  return {
    result,
    reviewExists: review !== null,
    remainingObjects: remaining?.filter((object) => object.id !== null).length ?? 0,
  };
}
