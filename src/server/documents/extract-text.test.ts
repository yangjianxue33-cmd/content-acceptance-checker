// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { extractDocumentText } from "./extract-text";

const fixtureDirectory = path.join(
  process.cwd(),
  "src/test/fixtures/documents",
);

async function fixture(name: string, type: string) {
  const bytes = await readFile(path.join(fixtureDirectory, name));

  return {
    name,
    type,
    size: bytes.byteLength,
    bytes,
  };
}

describe("extractDocumentText", () => {
  test("decodes a UTF-8 TXT document", async () => {
    const document = await fixture("sample.txt", "text/plain");

    await expect(extractDocumentText(document)).resolves.toContain(
      "A careful editor checks every handoff",
    );
  });

  test("extracts visible text from a DOCX document with mammoth", async () => {
    const document = await fixture(
      "sample.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    await expect(extractDocumentText(document)).resolves.toContain(
      "A careful editor checks every handoff",
    );
  });

  test("extracts text from a text-based PDF with unpdf", async () => {
    const document = await fixture("sample.pdf", "application/pdf");

    await expect(extractDocumentText(document)).resolves.toContain(
      "A careful editor checks every handoff",
    );
  });

  test("rejects an unsupported file type", async () => {
    await expect(
      extractDocumentText({
        name: "article.rtf",
        type: "application/rtf",
        size: 7,
        bytes: Buffer.from("{\\rtf1}"),
      }),
    ).rejects.toMatchObject({
      code: "unsupported_file_type",
      message: "We can review PDF, DOCX, or TXT files.",
    });
  });

  test("rejects a corrupt file even when its extension and MIME are allowed", async () => {
    await expect(
      extractDocumentText({
        name: "article.pdf",
        type: "application/pdf",
        size: 16,
        bytes: Buffer.from("%PDF-not-a-pdf"),
      }),
    ).rejects.toMatchObject({
      code: "corrupt_document",
    });
  });

  test("rejects a scanned or empty PDF without attempting OCR", async () => {
    const document = await fixture("sample.pdf", "application/pdf");

    await expect(
      extractDocumentText(document, {
        extractPdf: async () => " \n ",
      }),
    ).rejects.toMatchObject({
      code: "empty_document",
      message: "We couldn't extract reliable text from this PDF.",
    });
  });

  test("rejects an article file over 10 MB before parsing", async () => {
    await expect(
      extractDocumentText({
        name: "article.txt",
        type: "text/plain",
        size: 10 * 1024 * 1024 + 1,
        bytes: Buffer.from("small test buffer"),
      }),
    ).rejects.toMatchObject({
      code: "file_too_large",
      message: "This file exceeds the 10 MB limit.",
    });
  });
});
