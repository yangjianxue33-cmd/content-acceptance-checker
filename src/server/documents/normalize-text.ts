import {
  AI_RISK_MINIMUM_WORDS,
  ARTICLE_WORD_LIMIT,
  type NormalizedDocument,
} from "./contracts";

type DocumentValidationCode = "empty_document" | "too_many_words";

export class DocumentValidationError extends Error {
  constructor(
    public readonly code: DocumentValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

function normalizeParagraph(paragraph: string) {
  return paragraph
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function countEnglishWords(text: string) {
  const withoutUrls = text.replace(/https?:\/\/\S+/giu, " ");
  return (
    withoutUrls.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  );
}

export function normalizeDocumentText(text: string): NormalizedDocument {
  const paragraphs = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map(normalizeParagraph)
    .filter(Boolean);

  if (paragraphs.length === 0) {
    throw new DocumentValidationError(
      "empty_document",
      "We couldn't extract reliable text from this document.",
    );
  }

  const normalizedText = paragraphs.join("\n\n");
  const wordCount = countEnglishWords(normalizedText);

  if (wordCount > ARTICLE_WORD_LIMIT) {
    throw new DocumentValidationError(
      "too_many_words",
      "This review exceeds your 5,000-word per-document limit.",
    );
  }

  let cursor = 0;
  const offsets = paragraphs.map((paragraph) => {
    const start = cursor;
    const end = start + paragraph.length;
    cursor = end + 2;
    return { start, end, text: paragraph };
  });
  const aiRiskEligible = wordCount >= AI_RISK_MINIMUM_WORDS;

  return {
    text: normalizedText,
    wordCount,
    paragraphs: offsets,
    aiRiskEligible,
    warnings: aiRiskEligible
      ? []
      : ["AI-writing risk won't be assessed for text under 300 words."],
  };
}
