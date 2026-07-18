import { timingSafeEqual } from "node:crypto";

import type { AnalysisModule, ModuleStatus } from "@/domain/analysis";
import { ANALYSIS_MODULES } from "@/server/analysis/module-runner";
import { hashAccessToken } from "@/server/security/token";

type ReviewTerminalStatus = "completed" | "partial" | "failed";
export type ReviewProgressStatus =
  | "queued"
  | "reviewing"
  | ReviewTerminalStatus;

const MODULE_LABELS: Record<AnalysisModule, string> = {
  brief_fit: "Brief fit",
  evidence_citations: "Evidence & citations",
  editorial_quality: "Editorial quality",
  ai_risk: "AI-writing risk",
};

export class ReviewAnalysisAccessError extends Error {
  readonly code = "not_found";

  constructor() {
    super("Review not found");
    this.name = "ReviewAnalysisAccessError";
  }
}

function hashesMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function securityConfig() {
  const tokenHashSecret = process.env.TOKEN_HASH_SECRET;
  if (!tokenHashSecret) throw new Error("Missing token hash secret");
  return tokenHashSecret;
}

export async function startProductionReviewAnalysis(input: {
  reviewId: string;
  accessToken: string | null;
}) {
  if (!input.accessToken) throw new ReviewAnalysisAccessError();
  const [{ createClient }] = await Promise.all([
    import("@/server/supabase/admin"),
  ]);
  const accessTokenHash = hashAccessToken(input.accessToken, securityConfig());
  const { data, error } = await createClient().rpc(
    "start_anonymous_review_analysis",
    {
      p_review_id: input.reviewId,
      p_access_token_hash: accessTokenHash,
    },
  );
  if (error?.code === "P0001" || !data) {
    throw new ReviewAnalysisAccessError();
  }
  if (error) throw new Error("review_start_failed");
  const status = data as ReviewProgressStatus;
  return { status, shouldEnqueue: status !== "completed" };
}

export async function loadProductionReviewStatus(input: {
  reviewId: string;
  accessToken: string | null;
}) {
  if (!input.accessToken) throw new ReviewAnalysisAccessError();
  const [{ createClient }] = await Promise.all([
    import("@/server/supabase/admin"),
  ]);
  const client = createClient();
  const { data: review, error: reviewError } = await client
    .from("reviews")
    .select("id, anonymous_access_token_hash, delete_at, status")
    .eq("id", input.reviewId)
    .maybeSingle();
  const suppliedHash = hashAccessToken(input.accessToken, securityConfig());
  if (
    reviewError ||
    !review ||
    !review.anonymous_access_token_hash ||
    review.status === "deleted" ||
    new Date(review.delete_at).getTime() <= Date.now() ||
    !hashesMatch(suppliedHash, review.anonymous_access_token_hash)
  ) {
    throw new ReviewAnalysisAccessError();
  }

  const { data: rows, error: modulesError } = await client
    .from("analysis_modules")
    .select("module, status")
    .eq("review_id", input.reviewId);
  if (modulesError) throw new Error("review_status_failed");
  const statuses = new Map(
    (rows ?? []).map((row) => [row.module as AnalysisModule, row.status as ModuleStatus]),
  );
  const status = review.status as ReviewProgressStatus;
  const terminal = status === "completed" || status === "partial" || status === "failed";
  const reportReady = status === "completed" || status === "partial";
  return {
    reviewId: input.reviewId,
    status,
    terminal,
    reportReady,
    reportPath: reportReady ? `/review/report/${input.reviewId}` : null,
    modules: ANALYSIS_MODULES.map((module) => {
      const moduleStatus = statuses.get(module) ?? "queued";
      return {
        module,
        label: MODULE_LABELS[module],
        status: moduleStatus,
        error:
          moduleStatus === "unavailable"
            ? "Check temporarily unavailable."
            : null,
      };
    }),
  };
}
