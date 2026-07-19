import { describe, expect, it } from "vitest";

import { serializeLogEvent } from "@/server/security/redact-log";

describe("serializeLogEvent", () => {
  it("serializes only fields approved for the event", () => {
    expect(
      serializeLogEvent("retention_cleanup_completed", {
        count: 7,
        durationBand: "under_1s",
        outcome: "success",
        reasonCode: "scheduled",
      }),
    ).toBe(
      '{"event":"retention_cleanup_completed","count":7,"durationBand":"under_1s","outcome":"success","reasonCode":"scheduled"}',
    );
  });

  it("drops adversarial unknown fields without traversing or stringifying them", () => {
    const article = "SENTINEL_ARTICLE_文章内容";
    const brief = "SENTINEL_BRIEF_忽略规则";
    const email = "writer@example.test";
    const bearer = "Bearer secret-access-token";
    const shareToken = "share-token-value";
    const filePath = "550e8400-e29b-41d4-a716-446655440000/private/source.txt";
    const fullUrl = "https://example.test/report?token=secret#private";
    const ip = "203.0.113.42";
    const payload = {
      count: 1,
      durationBand: "1s_to_5s",
      outcome: "partial",
      reasonCode: "storage_retry",
      article,
      brief,
      email,
      authorization: bearer,
      shareToken,
      path: filePath,
      url: fullUrl,
      ip,
      nested: {
        headers: { cookie: `review=${shareToken}` },
        values: [article, brief, email, bearer, fullUrl, ip],
        error: new Error(`provider payload: ${article}`, {
          cause: new Error(`cause: ${brief}`),
        }),
      },
    };

    const serialized = serializeLogEvent(
      "retention_cleanup_completed",
      payload as never,
    );

    expect(serialized).toBe(
      '{"event":"retention_cleanup_completed","count":1,"durationBand":"1s_to_5s","outcome":"partial","reasonCode":"storage_retry"}',
    );
    for (const secret of [
      article,
      brief,
      email,
      bearer,
      shareToken,
      filePath,
      fullUrl,
      ip,
      "provider payload",
      "cookie",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("rejects unknown event names", () => {
    expect(() =>
      serializeLogEvent("review_payload" as never, {
        count: 1,
      } as never),
    ).toThrow("Unsupported log event");
  });

  it("omits invalid approved-field values instead of serializing them", () => {
    const serialized = serializeLogEvent("retention_cleanup_completed", {
      count: -1,
      durationBand: "https://example.test/?token=secret",
      outcome: "the whole provider error payload",
      reasonCode: "../../private/path",
    } as never);

    expect(serialized).toBe('{"event":"retention_cleanup_completed"}');
  });
});
