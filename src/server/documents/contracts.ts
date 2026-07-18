export const ARTICLE_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
export const ARTICLE_WORD_LIMIT = 5_000;
export const AI_RISK_MINIMUM_WORDS = 300;

export const CONTENT_TYPES = [
  "blog_post",
  "seo_article",
  "thought_leadership",
  "other",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export type UploadedDocument = {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
};

export type ParagraphOffset = {
  start: number;
  end: number;
  text: string;
};

export type NormalizedDocument = {
  text: string;
  wordCount: number;
  paragraphs: ParagraphOffset[];
  aiRiskEligible: boolean;
  warnings: string[];
};
