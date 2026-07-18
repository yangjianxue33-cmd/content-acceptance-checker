import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type {
  BriefRequirement,
  StructuredWritingAnalyzer,
} from "@/server/analysis/contracts";
import {
  MAX_REQUIREMENTS,
  MAX_REQUIREMENT_CATEGORY_LENGTH,
  MAX_REQUIREMENT_TEXT_LENGTH,
  MAX_SOURCE_EXCERPT_LENGTH,
} from "@/server/analysis/contracts";
import { decryptSourceText } from "@/server/security/source-text-encryption";
import { hashAccessToken } from "@/server/security/token";

type ReviewStatus = "awaiting_brief_confirmation" | "queued";

export type EditableRequirement = Omit<BriefRequirement, "sourceExcerpt"> & {
  id?: string;
  sourceExcerpt: string | null;
};

export type RequirementsReview = {
  id: string;
  anonymousAccessTokenHash: string | null;
  deleteAt: string;
  briefPresent: boolean;
  status: ReviewStatus;
  sourceTextEncrypted: Uint8Array | null;
  briefObjectPath: string | null;
  requirements: EditableRequirement[];
};

export type RequirementsRepository = {
  load(reviewId: string): Promise<RequirementsReview | null>;
  replace(
    reviewId: string,
    accessTokenHash: string,
    requirements: EditableRequirement[],
    confirm: boolean,
  ): Promise<ReviewStatus>;
};

export type RequirementsDependencies = {
  repository: RequirementsRepository;
  storage: {
    downloadBrief(objectPath: string): Promise<string>;
  };
  analyzer: StructuredWritingAnalyzer;
  tokenHashSecret: string;
  sourceTextEncryptionKey: string;
  now?: () => Date;
};

type AccessInput = {
  reviewId: string;
  accessToken: string | null;
};

const editableRequirementSchema = z.strictObject({
  category: z.string().trim().min(1).max(MAX_REQUIREMENT_CATEGORY_LENGTH),
  text: z.string().trim().min(1).max(MAX_REQUIREMENT_TEXT_LENGTH),
  isCritical: z.boolean(),
  sourceExcerpt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SOURCE_EXCERPT_LENGTH)
    .nullable(),
});

const editableRequirementsSchema = z
  .array(editableRequirementSchema)
  .max(MAX_REQUIREMENTS);

export class RequirementsAccessError extends Error {
  readonly code = "not_found";

  constructor() {
    super("Review not found");
    this.name = "RequirementsAccessError";
  }
}

type RequirementsLoadErrorCode =
  | "confirmation_failed"
  | "source_unavailable";

export class RequirementsLoadError extends Error {
  constructor(public readonly code: RequirementsLoadErrorCode) {
    super("Requirements could not be loaded");
    this.name = "RequirementsLoadError";
  }
}

export class RequirementsValidationError extends Error {
  readonly code = "invalid_requirements";

  constructor() {
    super("Check each requirement and try again.");
    this.name = "RequirementsValidationError";
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

async function loadOwnedReview(
  input: AccessInput,
  dependencies: RequirementsDependencies,
) {
  if (!input.accessToken) {
    throw new RequirementsAccessError();
  }

  const review = await dependencies.repository.load(input.reviewId);
  const suppliedHash = hashAccessToken(
    input.accessToken,
    dependencies.tokenHashSecret,
  );
  const expired = review
    ? new Date(review.deleteAt).getTime() <=
      (dependencies.now ?? (() => new Date()))().getTime()
    : true;

  if (
    !review ||
    !review.anonymousAccessTokenHash ||
    expired ||
    !hashesMatch(suppliedHash, review.anonymousAccessTokenHash)
  ) {
    throw new RequirementsAccessError();
  }

  return { review, accessTokenHash: suppliedHash };
}

export async function loadRequirementsForConfirmation(
  input: AccessInput,
  dependencies: RequirementsDependencies,
) {
  const { review, accessTokenHash } = await loadOwnedReview(input, dependencies);
  const nextPath = `/review/progress/${input.reviewId}`;

  if (!review.briefPresent || review.status === "queued") {
    return { kind: "redirect" as const, nextPath };
  }

  if (review.status !== "awaiting_brief_confirmation") {
    throw new RequirementsAccessError();
  }

  if (review.requirements.length > 0) {
    return {
      kind: "editor" as const,
      reviewId: input.reviewId,
      requirements: review.requirements,
    };
  }

  if (!review.briefObjectPath || !review.sourceTextEncrypted) {
    throw new RequirementsLoadError("source_unavailable");
  }

  try {
    const briefText = await dependencies.storage.downloadBrief(
      review.briefObjectPath,
    );
    const articleText = decryptSourceText(
      review.sourceTextEncrypted,
      dependencies.sourceTextEncryptionKey,
    );
    const requirements = await dependencies.analyzer.extractBrief({
      articleText,
      briefText,
    });
    await dependencies.repository.replace(
      input.reviewId,
      accessTokenHash,
      requirements,
      false,
    );
    return {
      kind: "editor" as const,
      reviewId: input.reviewId,
      requirements,
    };
  } catch (error) {
    if (error instanceof RequirementsAccessError) throw error;
    throw new RequirementsLoadError("source_unavailable");
  }
}

export async function confirmRequirements(
  input: AccessInput & { requirements: unknown },
  dependencies: RequirementsDependencies,
) {
  const { accessTokenHash } = await loadOwnedReview(input, dependencies);
  const parsed = editableRequirementsSchema.safeParse(input.requirements);
  if (!parsed.success) {
    throw new RequirementsValidationError();
  }

  try {
    await dependencies.repository.replace(
      input.reviewId,
      accessTokenHash,
      parsed.data,
      true,
    );
  } catch (error) {
    if (error instanceof RequirementsAccessError) throw error;
    throw new RequirementsLoadError("confirmation_failed");
  }

  return { nextPath: `/review/progress/${input.reviewId}` };
}

function byteaBytes(value: string) {
  if (!value.startsWith("\\x")) {
    throw new RequirementsLoadError("source_unavailable");
  }
  return Buffer.from(value.slice(2), "hex");
}

async function productionDependencies(): Promise<RequirementsDependencies> {
  const [{ createClient }, { OpenAIStructuredWritingAnalyzer }] =
    await Promise.all([
      import("@/server/supabase/admin"),
      import("@/server/analysis/openai-analyzer"),
    ]);
  const tokenHashSecret = process.env.TOKEN_HASH_SECRET;
  const sourceTextEncryptionKey = process.env.SOURCE_TEXT_ENCRYPTION_KEY;
  if (!tokenHashSecret || !sourceTextEncryptionKey) {
    throw new Error("Missing review security environment variables");
  }

  const client = createClient();
  return {
    tokenHashSecret,
    sourceTextEncryptionKey,
    analyzer: new OpenAIStructuredWritingAnalyzer(),
    storage: {
      async downloadBrief(objectPath) {
        const { data, error } = await client.storage
          .from("review-source")
          .download(objectPath);
        if (error || !data) {
          throw new RequirementsLoadError("source_unavailable");
        }
        return data.text();
      },
    },
    repository: {
      async load(reviewId) {
        const { data: review, error: reviewError } = await client
          .from("reviews")
          .select(
            "id, anonymous_access_token_hash, delete_at, brief_present, status, source_text_encrypted",
          )
          .eq("id", reviewId)
          .maybeSingle();
        if (reviewError) {
          throw new RequirementsLoadError("source_unavailable");
        }
        if (!review) return null;

        const [requirementsResult, briefFileResult] = await Promise.all([
          client
            .from("requirements")
            .select(
              "id, category, requirement_text, is_critical, source_excerpt",
            )
            .eq("review_id", reviewId)
            .order("created_at", { ascending: true }),
          client
            .from("review_files")
            .select("object_path")
            .eq("review_id", reviewId)
            .eq("file_kind", "brief")
            .maybeSingle(),
        ]);
        if (requirementsResult.error || briefFileResult.error) {
          throw new RequirementsLoadError("source_unavailable");
        }

        return {
          id: review.id,
          anonymousAccessTokenHash: review.anonymous_access_token_hash,
          deleteAt: review.delete_at,
          briefPresent: review.brief_present,
          status: review.status as ReviewStatus,
          sourceTextEncrypted: review.source_text_encrypted
            ? byteaBytes(review.source_text_encrypted)
            : null,
          briefObjectPath: briefFileResult.data?.object_path ?? null,
          requirements: (requirementsResult.data ?? []).map((requirement) => ({
            id: requirement.id,
            category: requirement.category,
            text: requirement.requirement_text,
            isCritical: requirement.is_critical,
            sourceExcerpt: requirement.source_excerpt,
          })),
        };
      },
      async replace(reviewId, accessTokenHash, requirements, confirm) {
        const payload = requirements.map((requirement) => ({
          category: requirement.category,
          requirement_text: requirement.text,
          is_critical: requirement.isCritical,
          source_excerpt: requirement.sourceExcerpt,
        }));
        const { data, error } = await client.rpc("replace_review_requirements", {
          p_review_id: reviewId,
          p_access_token_hash: accessTokenHash,
          p_requirements: payload,
          p_confirm: confirm,
        });
        if (
          error?.code === "P0001" &&
          error.message === "review_access_denied"
        ) {
          throw new RequirementsAccessError();
        }
        if (
          error ||
          (data !== "awaiting_brief_confirmation" && data !== "queued")
        ) {
          throw new RequirementsLoadError(
            confirm ? "confirmation_failed" : "source_unavailable",
          );
        }
        return data;
      },
    },
  };
}

export async function loadProductionRequirements(input: AccessInput) {
  return loadRequirementsForConfirmation(input, await productionDependencies());
}

export async function confirmProductionRequirements(
  input: AccessInput & { requirements: unknown },
) {
  return confirmRequirements(input, await productionDependencies());
}
