import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database.generated";
import type { UploadedDocument } from "@/server/documents/contracts";
import {
  createAnonymousReview,
  isSafeCreateReviewError,
  type CreateReviewInput,
  type ReviewCreationRecord,
} from "@/server/reviews/create-review";

type CreateReview = typeof createAnonymousReview;

type RouteDependencies = {
  createReview: (
    input: CreateReviewInput,
  ) => ReturnType<CreateReview>;
};

async function uploadedDocument(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) {
    return undefined;
  }
  return {
    name: value.name,
    type: value.type,
    size: value.size,
    bytes: new Uint8Array(await value.arrayBuffer()),
  } satisfies UploadedDocument;
}

function formValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : undefined;
}

function bytea(bytes: Uint8Array) {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

function rpcFiles(files: ReviewCreationRecord["files"]): Json {
  return files.map((file) => ({
    file_kind: file.fileKind,
    object_path: file.objectPath,
    original_filename: file.originalFilename,
    mime_type: file.mimeType,
    size_bytes: file.sizeBytes,
  }));
}

async function createProductionReview(input: CreateReviewInput) {
  const [{ createClient }, { createAnonymousReview: createReview }] =
    await Promise.all([
      import("@/server/supabase/admin"),
      import("@/server/reviews/create-review"),
    ]);
  const client: SupabaseClient<Database> = createClient();
  const tokenHashSecret = process.env.TOKEN_HASH_SECRET;
  const sourceTextEncryptionKey = process.env.SOURCE_TEXT_ENCRYPTION_KEY;
  if (!tokenHashSecret || !sourceTextEncryptionKey) {
    throw new Error("Missing review security environment variables");
  }

  return createReview(input, {
    tokenHashSecret,
    sourceTextEncryptionKey,
    storage: {
      async upload(object) {
        const { error } = await client.storage
          .from("review-source")
          .upload(object.path, object.bytes, {
            contentType: object.contentType,
            upsert: false,
          });
        if (error) throw new Error("storage_upload_failed");
      },
      async remove(paths) {
        const { error } = await client.storage.from("review-source").remove(paths);
        if (error) throw new Error("storage_cleanup_failed");
      },
    },
    repository: {
      async create(record) {
        type CreateReviewArgs =
          Database["public"]["Functions"]["create_anonymous_review"]["Args"];
        const { error } = await client.rpc(
          "create_anonymous_review",
          {
            p_review_id: record.id,
            p_access_token_hash: record.accessTokenHash,
            p_title: record.title,
            p_content_type: record.contentType,
            p_source_input_type: record.sourceInputType,
            p_original_filename: record.originalFilename,
            p_word_count: record.wordCount,
            p_brief_present: record.briefPresent,
            p_status: record.status,
            p_source_text_encrypted: bytea(record.sourceTextEncrypted),
            p_delete_at: record.deleteAt,
            p_files: rpcFiles(record.files),
          } as unknown as CreateReviewArgs,
        );
        if (error) throw new Error("review_rpc_failed");
      },
    },
  });
}

export function createReviewsPostHandler(
  dependencies: RouteDependencies = { createReview: createProductionReview },
) {
  return async function POST(request: Request) {
    try {
      const formData = await request.formData();
      const result = await dependencies.createReview({
        bodyText: formValue(formData.get("bodyText")),
        briefText: formValue(formData.get("briefText")),
        contentType: formValue(formData.get("contentType")) ?? "",
        file: await uploadedDocument(formData.get("file")),
      });
      const response = Response.json(
        {
          reviewId: result.reviewId,
          accessToken: result.accessToken,
          nextPath: result.nextPath,
        },
        { status: 201 },
      );
      response.headers.append(
        "Set-Cookie",
        `anonymous_review_access=${result.accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
      return response;
    } catch (error) {
      if (isSafeCreateReviewError(error)) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: 400 },
        );
      }
      return Response.json(
        { error: "We couldn't create this review. Try again." },
        { status: 500 },
      );
    }
  };
}

export const POST = createReviewsPostHandler();
