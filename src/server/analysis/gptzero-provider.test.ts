// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { GptZeroAiRiskProvider } from "./gptzero-provider";

const article = Array.from({ length: 300 }, (_, index) => `word${index}`).join(" ");

function providerResponse(aiProbability = 0.72) {
  return {
    documents: [
      {
        document_classification: "MIXED",
        class_probabilities: {
          HUMAN_ONLY: 0.18,
          MIXED: 0.1,
          AI_ONLY: aiProbability,
        },
        predicted_class: "AI_ONLY",
        confidence_category: "HIGH",
        sentences: [{ sentence: "private sentence", highlighted: true }],
      },
    ],
  };
}

function setup(
  response: unknown = providerResponse(),
  overrides: Record<string, unknown> = {},
) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return {
    fetch,
    provider: new GptZeroAiRiskProvider({
      apiKey: "test-key",
      endpoint: "https://gptzero.example/v2/predict/text",
      modelVersion: "2026-07-test",
      mediumThreshold: 0.5,
      highThreshold: 0.8,
      timeoutMs: 25,
      fetch,
      ...overrides,
    }),
  };
}

describe("GptZeroAiRiskProvider", () => {
  test("uses the official text endpoint contract without storing raw provider data", async () => {
    const { provider, fetch } = setup();

    const result = await provider.assess({ articleText: article, wordCount: 300 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://gptzero.example/v2/predict/text",
      expect.objectContaining({
        method: "POST",
        headers: {
          "x-api-key": "test-key",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ document: article, version: "2026-07-test" }),
      }),
    );
    expect(result).toEqual({
      status: "complete",
      risk: "medium",
      confidence: "high",
      caveats: [
        "AI-writing risk is advisory and does not prove authorship.",
      ],
    });
    expect(JSON.stringify(result)).not.toContain("0.72");
    expect(JSON.stringify(result)).not.toContain("private sentence");
  });

  test("does not call GPTZero for documents under 300 words", async () => {
    const { provider, fetch } = setup();

    await expect(
      provider.assess({ articleText: "short private draft", wordCount: 299 }),
    ).resolves.toEqual({
      status: "not_assessed",
      risk: "not_assessed",
      confidence: null,
      caveats: ["AI-writing risk requires at least 300 words."],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    [0.49, "low"],
    [0.5, "medium"],
    [0.79, "medium"],
    [0.8, "high"],
  ])("maps probability %s through configured thresholds", async (probability, risk) => {
    const { provider } = setup(providerResponse(probability));

    await expect(provider.assess({ articleText: article, wordCount: 300 })).resolves.toMatchObject({
      status: "complete",
      risk,
    });
  });

  test.each<[string, unknown]>([
    ["missing documents", {}],
    [
      "unknown classification",
      {
        ...providerResponse(),
        documents: [
          {
            ...providerResponse().documents[0],
            document_classification: "UNKNOWN",
          },
        ],
      },
    ],
    ["out-of-range probability", providerResponse(1.1)],
    [
      "extra probability field",
      {
        ...providerResponse(),
        documents: [
          {
            ...providerResponse().documents[0],
            class_probabilities: {
              ...providerResponse().documents[0].class_probabilities,
              hidden: 0.2,
            },
          },
        ],
      },
    ],
  ])("rejects malformed provider output: %s", async (_caseName, payload) => {
    const { provider } = setup(payload);

    await expect(provider.assess({ articleText: article, wordCount: 300 })).resolves.toEqual({
      status: "unavailable",
      risk: null,
      confidence: null,
      caveats: ["AI-writing risk could not be assessed."],
      errorCode: "invalid_provider_output",
    });
  });

  test.each([
    ["provider error", new Response("private provider payload", { status: 503 })],
    ["invalid JSON", new Response("not json", { status: 200 })],
  ])("returns a safe unavailable result for %s", async (_caseName, response) => {
    const fetch = vi.fn().mockResolvedValue(response);
    const { provider } = setup(undefined, { fetch });

    const result = await provider.assess({ articleText: article, wordCount: 300 });

    expect(result).toMatchObject({ status: "unavailable", errorCode: "provider_failed" });
    expect(JSON.stringify(result)).not.toContain("private provider payload");
  });

  test("aborts on timeout and returns a safe unavailable result", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("PRIVATE provider timeout", "AbortError")),
        );
      }),
    );
    const { provider } = setup(undefined, { fetch, timeoutMs: 5 });

    await expect(provider.assess({ articleText: article, wordCount: 300 })).resolves.toEqual({
      status: "unavailable",
      risk: null,
      confidence: null,
      caveats: ["AI-writing risk could not be assessed."],
      errorCode: "provider_timeout",
    });
  });

  test("keeps the timeout active while reading the provider body", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("private stalled body", "AbortError")),
            );
          }),
      } as Response),
    );
    const { provider } = setup(undefined, { fetch, timeoutMs: 5_000 });
    const result = provider.assess({ articleText: article, wordCount: 300 });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toMatchObject({
      status: "unavailable",
      errorCode: "provider_timeout",
    });
    vi.useRealTimers();
  });

  test("validates threshold configuration", () => {
    expect(() => setup(undefined, { mediumThreshold: 0.9, highThreshold: 0.8 })).toThrow(
      "Invalid AI risk thresholds",
    );
  });
});
