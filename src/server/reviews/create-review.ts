import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  CONTENT_TYPES,
  type ContentType,
  type UploadedDocument,
} from "@/server/documents/contracts";
import {
  DocumentExtractionError,
  extractDocumentText,
} from "@/server/documents/extract-text";
import {
  DocumentValidationError,
  normalizeDocumentText,
} from "@/server/documents/normalize-text";
import { encryptSourceText } from "@/server/security/source-text-encryption";
import { generateAccessToken, hashAccessToken } from "@/server/security/token";

type ReviewStatus = "awaiting_brief_confirmation" | "queued";
type SourceInputType = "pasted_text" | "uploaded_file";
type FileKind = "brief" | "source";

export type ReviewFileRecord = {
  fileKind: FileKind;
  objectPath: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
};

export type ReviewCreationRecord = {
  id: string;
  accessTokenHash: string;
  title: string;
  contentType: ContentType;
  sourceInputType: SourceInputType;
  originalFilename: string | null;
  wordCount: number;
  briefPresent: boolean;
  status: ReviewStatus;
  sourceTextEncrypted: Buffer;
  deleteAt: string;
  files: ReviewFileRecord[];
};

export type ReviewCreationStorage = {
  upload(object: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<void>;
  remove(paths: string[]): Promise<void>;
};

export type ReviewCreationRepository = {
  create(record: ReviewCreationRecord): Promise<void>;
};

export type CreateReviewDependencies = {
  storage: ReviewCreationStorage;
  repository: ReviewCreationRepository;
  tokenHashSecret: string;
  sourceTextEncryptionKey: string;
  createId?: () => string;
  now?: () => Date;
  createToken?: () => string;
  extractText?: (document: UploadedDocument) => Promise<string>;
};

export type CreateReviewInput = {
  bodyText?: string;
  briefText?: string;
  contentType: string;
  file?: UploadedDocument;
};

type CreateReviewErrorCode =
  | "article_source_count"
  | "creation_failed"
  | "invalid_content_type";

export class CreateReviewError extends Error {
  constructor(
    public readonly code: CreateReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreateReviewError";
  }
}

function isContentType(value: string): value is ContentType {
  return CONTENT_TYPES.some((contentType) => contentType === value);
}

function safeFilename(filename: string) {
  return path
    .basename(filename)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

function safeTitle(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function titleFromText(text: string) {
  const firstLine = text.split("\n").find((line) => line.trim());
  return safeTitle(firstLine ?? text) || "Untitled review";
}

async function compensateUploads(
  storage: ReviewCreationStorage,
  uploadedPaths: string[],
) {
  if (uploadedPaths.length === 0) {
    return;
  }
  try {
    await storage.remove(uploadedPaths);
  } catch {
    // Cleanup is retried by retention operations; never expose object paths here.
  }
}

export async function createAnonymousReview(
  input: CreateReviewInput,
  dependencies: CreateReviewDependencies,
) {
  if (!isContentType(input.contentType)) {
    throw new CreateReviewError(
      "invalid_content_type",
      "Choose a content type before starting the review.",
    );
  }

  const hasBodyText = Boolean(input.bodyText?.trim());
  const hasFile = Boolean(input.file);
  if (Number(hasBodyText) + Number(hasFile) !== 1) {
    throw new CreateReviewError(
      "article_source_count",
      "Paste text or upload one document, but not both.",
    );
  }

  const reviewId = (dependencies.createId ?? randomUUID)();
  const rawText = input.file
    ? await (dependencies.extractText ?? extractDocumentText)(input.file)
    : input.bodyText!;
  const source = normalizeDocumentText(rawText);
  const normalizedBrief = input.briefText?.trim()
    ? normalizeDocumentText(input.briefText)
    : null;
  const filename = input.file ? safeFilename(input.file.name) : null;
  const sourceInputType: SourceInputType = input.file
    ? "uploaded_file"
    : "pasted_text";
  const title = input.file
    ? safeTitle(path.basename(filename!, path.extname(filename!))) ||
      "Untitled review"
    : titleFromText(source.text);
  const accessToken = (dependencies.createToken ?? generateAccessToken)();
  const accessTokenHash = hashAccessToken(
    accessToken,
    dependencies.tokenHashSecret,
  );
  const sourceTextEncrypted = encryptSourceText(
    source.text,
    dependencies.sourceTextEncryptionKey,
  );
  const deleteAt = new Date(
    (dependencies.now ?? (() => new Date()))().getTime() + 24 * 60 * 60 * 1_000,
  ).toISOString();
  const uploads: Array<{
    path: string;
    bytes: Uint8Array;
    contentType: string;
    metadata: ReviewFileRecord;
  }> = [];

  if (input.file) {
    const extension = path.extname(filename!).toLowerCase();
    const objectPath = `${reviewId}/source${extension}`;
    uploads.push({
      path: objectPath,
      bytes: input.file.bytes,
      contentType: input.file.type,
      metadata: {
        fileKind: "source",
        objectPath,
        originalFilename: filename,
        mimeType: input.file.type,
        sizeBytes: input.file.bytes.byteLength,
      },
    });
  }

  if (normalizedBrief) {
    const bytes = Buffer.from(normalizedBrief.text, "utf8");
    const objectPath = `${reviewId}/brief.txt`;
    uploads.push({
      path: objectPath,
      bytes,
      contentType: "text/plain",
      metadata: {
        fileKind: "brief",
        objectPath,
        originalFilename: null,
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
      },
    });
  }

  const uploadedPaths: string[] = [];
  try {
    for (const upload of uploads) {
      await dependencies.storage.upload({
        path: upload.path,
        bytes: upload.bytes,
        contentType: upload.contentType,
      });
      uploadedPaths.push(upload.path);
    }

    await dependencies.repository.create({
      id: reviewId,
      accessTokenHash,
      title,
      contentType: input.contentType,
      sourceInputType,
      originalFilename: filename,
      wordCount: source.wordCount,
      briefPresent: Boolean(normalizedBrief),
      status: normalizedBrief ? "awaiting_brief_confirmation" : "queued",
      sourceTextEncrypted,
      deleteAt,
      files: uploads.map((upload) => upload.metadata),
    });
  } catch {
    await compensateUploads(dependencies.storage, uploadedPaths);
    throw new CreateReviewError(
      "creation_failed",
      "We couldn't create this review. Try again.",
    );
  }

  return {
    reviewId,
    accessToken,
    nextPath: normalizedBrief
      ? `/review/brief-confirmation?reviewId=${reviewId}`
      : `/review/progress/${reviewId}`,
    aiRiskEligible: source.aiRiskEligible,
  };
}

export function isSafeCreateReviewError(error: unknown) {
  return (
    error instanceof CreateReviewError ||
    error instanceof DocumentExtractionError ||
    error instanceof DocumentValidationError
  );
}
