import { z } from "zod";

import type { AiRisk } from "@/domain/analysis";

const DEFAULT_ENDPOINT = "https://api.gptzero.me/v2/predict/text";

const classProbabilitiesSchema = z
  .object({
    human: z.number().min(0).max(1),
    mixed: z.number().min(0).max(1),
    ai: z.number().min(0).max(1),
  })
  .strict();

const predictedClassSchema = z.union([
  z.enum(["human", "mixed", "ai"]),
  z.enum(["HUMAN_ONLY", "MIXED", "AI_ONLY"]),
]);

const providerResponseSchema = z
  .object({
    documents: z
      .array(
        z
          .object({
            document_classification: z.enum([
              "HUMAN_ONLY",
              "MIXED",
              "AI_ONLY",
            ]),
            class_probabilities: classProbabilitiesSchema,
            predicted_class: predictedClassSchema,
            confidence_category: z.enum(["low", "medium", "high"]),
            sentences: z
              .array(
                z
                  .object({
                    highlighted: z.boolean().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

export type AiRiskAssessment =
  | {
      status: "complete";
      risk: Exclude<AiRisk, "not_assessed">;
      confidence: "low" | "medium" | "high";
      caveats: string[];
    }
  | {
      status: "not_assessed";
      risk: "not_assessed";
      confidence: null;
      caveats: string[];
    }
  | {
      status: "unavailable";
      risk: null;
      confidence: null;
      caveats: string[];
      errorCode:
        | "invalid_provider_output"
        | "provider_failed"
        | "provider_timeout";
    };

export interface AiRiskProvider {
  assess(input: {
    articleText: string;
    wordCount: number;
  }): Promise<AiRiskAssessment>;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type GptZeroDependencies = {
  apiKey?: string;
  endpoint?: string;
  modelVersion?: string;
  mediumThreshold?: number;
  highThreshold?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
};

function thresholdFrom(value: number | undefined, envName: string) {
  const configured = value ?? Number(process.env[envName]);
  return configured;
}

function unavailable(
  errorCode: "invalid_provider_output" | "provider_failed" | "provider_timeout",
): AiRiskAssessment {
  return {
    status: "unavailable",
    risk: null,
    confidence: null,
    caveats: ["AI-writing risk could not be assessed."],
    errorCode,
  };
}

export class GptZeroAiRiskProvider implements AiRiskProvider {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly modelVersion?: string;
  private readonly mediumThreshold: number;
  private readonly highThreshold: number;
  private readonly timeoutMs: number;
  private readonly fetch: FetchLike;

  constructor(dependencies: GptZeroDependencies = {}) {
    const apiKey = dependencies.apiKey ?? process.env.GPTZERO_API_KEY;
    if (!apiKey) throw new Error("Missing GPTZero API key");

    const mediumThreshold = thresholdFrom(
      dependencies.mediumThreshold,
      "AI_RISK_MEDIUM_THRESHOLD",
    );
    const highThreshold = thresholdFrom(
      dependencies.highThreshold,
      "AI_RISK_HIGH_THRESHOLD",
    );
    if (
      !Number.isFinite(mediumThreshold) ||
      !Number.isFinite(highThreshold) ||
      mediumThreshold < 0 ||
      mediumThreshold > 1 ||
      highThreshold < 0 ||
      highThreshold > 1 ||
      mediumThreshold >= highThreshold
    ) {
      throw new Error("Invalid AI risk thresholds");
    }

    this.apiKey = apiKey;
    this.endpoint = dependencies.endpoint ?? DEFAULT_ENDPOINT;
    this.modelVersion =
      dependencies.modelVersion ?? process.env.GPTZERO_MODEL_VERSION;
    this.mediumThreshold = mediumThreshold;
    this.highThreshold = highThreshold;
    this.timeoutMs = dependencies.timeoutMs ?? 5_000;
    this.fetch = dependencies.fetch ?? globalThis.fetch;
  }

  async assess(input: {
    articleText: string;
    wordCount: number;
  }): Promise<AiRiskAssessment> {
    if (input.wordCount < 300) {
      return {
        status: "not_assessed",
        risk: "not_assessed",
        confidence: null,
        caveats: ["AI-writing risk requires at least 300 words."],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let payload: unknown;
    try {
      const response = await this.fetch(this.endpoint, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document: input.articleText,
          ...(this.modelVersion ? { version: this.modelVersion } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) return unavailable("provider_failed");
      payload = await response.json();
    } catch {
      return unavailable(controller.signal.aborted ? "provider_timeout" : "provider_failed");
    } finally {
      clearTimeout(timeout);
    }
    const parsed = providerResponseSchema.safeParse(payload);
    if (!parsed.success) return unavailable("invalid_provider_output");

    const document = parsed.data.documents[0];
    const probability = document.class_probabilities.ai;
    const risk =
      probability >= this.highThreshold
        ? "high"
        : probability >= this.mediumThreshold
          ? "medium"
          : "low";

    return {
      status: "complete",
      risk,
      confidence: document.confidence_category,
      caveats: ["AI-writing risk is advisory and does not prove authorship."],
    };
  }
}
