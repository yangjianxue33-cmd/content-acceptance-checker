import { describe, expect, test } from "vitest";

import { normalizeDocumentText } from "./normalize-text";

function words(count: number) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

describe("normalizeDocumentText", () => {
  test("normalizes whitespace and records offsets for each paragraph", () => {
    const result = normalizeDocumentText(
      "  Review title  \r\n\r\n First   paragraph.\r\nSecond line. \n\n Final note.  ",
    );

    expect(result.text).toBe(
      "Review title\n\nFirst paragraph.\nSecond line.\n\nFinal note.",
    );
    expect(result.paragraphs).toEqual([
      { start: 0, end: 12, text: "Review title" },
      { start: 14, end: 43, text: "First paragraph.\nSecond line." },
      { start: 45, end: 56, text: "Final note." },
    ]);
  });

  test("counts English words while ignoring standalone URLs and punctuation", () => {
    const result = normalizeDocumentText(
      "A well-researched editor's note — see https://example.com/report !!!",
    );

    expect(result.wordCount).toBe(5);
  });

  test("accepts text under 300 words with an AI-risk warning", () => {
    const result = normalizeDocumentText(words(299));

    expect(result.wordCount).toBe(299);
    expect(result.aiRiskEligible).toBe(false);
    expect(result.warnings).toContain(
      "AI-writing risk won't be assessed for text under 300 words.",
    );
  });

  test("rejects text over the 5,000-word ceiling", () => {
    expect(() => normalizeDocumentText(words(5_001))).toThrowError(
      expect.objectContaining({
        code: "too_many_words",
        message: "This review exceeds your 5,000-word per-document limit.",
      }),
    );
  });

  test("rejects empty or whitespace-only text", () => {
    expect(() => normalizeDocumentText(" \n\t ")).toThrowError(
      expect.objectContaining({
        code: "empty_document",
      }),
    );
  });
});
