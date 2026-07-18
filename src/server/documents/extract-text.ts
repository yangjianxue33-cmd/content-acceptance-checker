import path from "node:path";

import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

import {
  ARTICLE_FILE_SIZE_LIMIT_BYTES,
  type UploadedDocument,
} from "./contracts";

type DocumentExtractionCode =
  | "corrupt_document"
  | "empty_document"
  | "file_too_large"
  | "unsupported_file_type";

type Extractors = {
  extractDocx: (bytes: Uint8Array) => Promise<string>;
  extractPdf: (bytes: Uint8Array) => Promise<string>;
};

export class DocumentExtractionError extends Error {
  constructor(
    public readonly code: DocumentExtractionCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

const formats = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
} as const;

const defaultExtractors: Extractors = {
  async extractDocx(bytes) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  },
  async extractPdf(bytes) {
    const result = await extractPdfText(new Uint8Array(bytes), {
      mergePages: true,
    });
    return result.text;
  },
};

function assertSupportedFormat(document: UploadedDocument) {
  const extension = path.extname(document.name).toLowerCase();
  const expectedMime = formats[extension as keyof typeof formats];

  if (!expectedMime || document.type !== expectedMime) {
    throw new DocumentExtractionError(
      "unsupported_file_type",
      "We can review PDF, DOCX, or TXT files.",
    );
  }

  return extension as keyof typeof formats;
}

function assertContentSignature(
  extension: keyof typeof formats,
  bytes: Uint8Array,
) {
  const isPdf = Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const hasNullByte = bytes.includes(0);

  if (
    (extension === ".pdf" && !isPdf) ||
    (extension === ".docx" && !isZip) ||
    (extension === ".txt" && hasNullByte)
  ) {
    throw new DocumentExtractionError(
      "corrupt_document",
      "We couldn't extract reliable text from this document.",
    );
  }
}

export async function extractDocumentText(
  document: UploadedDocument,
  extractors: Partial<Extractors> = {},
) {
  if (
    Math.max(document.size, document.bytes.byteLength) >
    ARTICLE_FILE_SIZE_LIMIT_BYTES
  ) {
    throw new DocumentExtractionError(
      "file_too_large",
      "This file exceeds the 10 MB limit.",
    );
  }

  const extension = assertSupportedFormat(document);
  assertContentSignature(extension, document.bytes);

  try {
    let text: string;
    if (extension === ".pdf") {
      text = await (extractors.extractPdf ?? defaultExtractors.extractPdf)(
        document.bytes,
      );
    } else if (extension === ".docx") {
      text = await (extractors.extractDocx ?? defaultExtractors.extractDocx)(
        document.bytes,
      );
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(document.bytes);
    }

    if (!text.trim()) {
      throw new DocumentExtractionError(
        "empty_document",
        extension === ".pdf"
          ? "We couldn't extract reliable text from this PDF."
          : "We couldn't extract reliable text from this document.",
      );
    }

    return text;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }
    throw new DocumentExtractionError(
      "corrupt_document",
      "We couldn't extract reliable text from this document.",
    );
  }
}
