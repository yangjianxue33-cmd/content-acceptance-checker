import { hashAccessToken } from "@/server/security/token";
import type { Database } from "@/types/database.generated";

export const USER_DECISIONS = [
  "ready",
  "revisions_requested",
  "manually_reviewed",
] as const;

export type UserDecision = (typeof USER_DECISIONS)[number];

export type DecisionRepository = {
  setDecision(input: {
    reviewId: string;
    accessTokenHash: string;
    decision: UserDecision;
  }): Promise<string>;
};

export class ReviewDecisionAccessError extends Error {
  readonly code = "not_found";

  constructor() {
    super("Review not found");
    this.name = "ReviewDecisionAccessError";
  }
}

export class ReviewDecisionValidationError extends Error {
  readonly code = "invalid_decision";

  constructor() {
    super("Choose a valid editor decision.");
    this.name = "ReviewDecisionValidationError";
  }
}

export function isUserDecision(value: unknown): value is UserDecision {
  return (
    typeof value === "string" &&
    USER_DECISIONS.some((decision) => decision === value)
  );
}

export async function setReviewDecision(
  input: {
    reviewId: string;
    accessToken: string | null;
    tokenHashSecret: string;
    decision: UserDecision;
  },
  repository: DecisionRepository,
) {
  if (!input.accessToken) throw new ReviewDecisionAccessError();
  if (!isUserDecision(input.decision)) {
    throw new ReviewDecisionValidationError();
  }
  const recordedAt = await repository.setDecision({
    reviewId: input.reviewId,
    accessTokenHash: hashAccessToken(
      input.accessToken,
      input.tokenHashSecret,
    ),
    decision: input.decision,
  });
  return { decision: input.decision, recordedAt };
}

function productionSecurityConfig() {
  const tokenHashSecret = process.env.TOKEN_HASH_SECRET;
  if (!tokenHashSecret) throw new Error("Missing token hash secret");
  return tokenHashSecret;
}

export async function setProductionReviewDecision(input: {
  reviewId: string;
  accessToken: string | null;
  decision: UserDecision;
}) {
  const { createClient } = await import("@/server/supabase/admin");
  const client = createClient();
  return setReviewDecision(
    { ...input, tokenHashSecret: productionSecurityConfig() },
    {
      async setDecision(args) {
        type RpcArgs =
          Database["public"]["Functions"]["set_anonymous_review_decision"]["Args"];
        const { data, error } = await client.rpc(
          "set_anonymous_review_decision",
          {
            p_review_id: args.reviewId,
            p_access_token_hash: args.accessTokenHash,
            p_decision: args.decision,
          } as RpcArgs,
        );
        if (error?.code === "P0001") throw new ReviewDecisionAccessError();
        if (error || !data) throw new Error("review_decision_failed");
        return data;
      },
    },
  );
}
