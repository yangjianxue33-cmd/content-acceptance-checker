// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { fetchSafeUrl, SafeUrlError } from "./safe-url";

type Reply = {
  statusCode: number;
  headers?: Record<string, string | undefined>;
  bytesRead?: number;
};

function harness(options: {
  addresses?: Record<string, string[]>;
  replies?: Reply[];
  request?: (input: {
    url: URL;
    address: string;
    family: 4 | 6;
    signal: AbortSignal;
    maxBytes: number;
  }) => Promise<Reply>;
} = {}) {
  const resolve = vi.fn(async (hostname: string) =>
    (options.addresses?.[hostname] ?? ["93.184.216.34"]).map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    })),
  );
  const replies = [...(options.replies ?? [{ statusCode: 200, headers: { "content-type": "text/html" }, bytesRead: 12 }])];
  const request = vi.fn(
    options.request ??
      (async () => replies.shift() ?? { statusCode: 500, bytesRead: 0 }),
  );
  return { resolve, request };
}

describe("fetchSafeUrl", () => {
  test.each([
    "http://example.test/article",
    "https://example.test/article#private-fragment",
  ])("allows %s and pins the validated address", async (input) => {
    const setup = harness();

    const result = await fetchSafeUrl(input, setup);

    expect(result).toEqual({
      url: input.replace("#private-fragment", ""),
      statusCode: 200,
      result: "reachable",
      reasonCode: null,
    });
    expect(setup.resolve).toHaveBeenCalledWith("example.test");
    expect(setup.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.any(URL),
        address: "93.184.216.34",
        family: 4,
        maxBytes: 1_000_000,
      }),
    );
    expect(setup.request.mock.calls[0][0].url.hostname).toBe("example.test");
  });

  test.each([
    ["unsupported scheme", "ftp://example.test/file"],
    ["credentials", "https://user:pass@example.test/file"],
    ["localhost name", "https://localhost/file"],
    ["localhost suffix", "https://service.localhost/file"],
    ["nonstandard HTTP port", "http://example.test:8080/file"],
    ["nonstandard HTTPS port", "https://example.test:444/file"],
  ])("rejects %s before network access", async (_caseName, input) => {
    const setup = harness();

    await expect(fetchSafeUrl(input, setup)).rejects.toBeInstanceOf(SafeUrlError);
    expect(setup.resolve).not.toHaveBeenCalled();
    expect(setup.request).not.toHaveBeenCalled();
  });

  test.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
  ])("rejects non-public IPv4 %s", async (address) => {
    const setup = harness({ addresses: { "example.test": [address] } });

    await expect(fetchSafeUrl("https://example.test", setup)).rejects.toMatchObject({
      code: "unsafe_address",
    });
    expect(setup.request).not.toHaveBeenCalled();
  });

  test.each([
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
  ])("rejects non-public IPv6 %s", async (address) => {
    const setup = harness({ addresses: { "example.test": [address] } });

    await expect(fetchSafeUrl("https://example.test", setup)).rejects.toMatchObject({
      code: "unsafe_address",
    });
    expect(setup.request).not.toHaveBeenCalled();
  });

  test("rejects a DNS answer set containing a rebound private address", async () => {
    const setup = harness({
      addresses: { "example.test": ["93.184.216.34", "127.0.0.1"] },
    });

    await expect(fetchSafeUrl("https://example.test", setup)).rejects.toMatchObject({
      code: "unsafe_address",
    });
    expect(setup.request).not.toHaveBeenCalled();
  });

  test("re-resolves a redirect and blocks a private destination", async () => {
    const setup = harness({
      addresses: {
        "example.test": ["93.184.216.34"],
        "internal.test": ["10.0.0.5"],
      },
      replies: [
        {
          statusCode: 302,
          headers: { location: "http://internal.test/admin" },
          bytesRead: 0,
        },
      ],
    });

    await expect(fetchSafeUrl("https://example.test/start", setup)).rejects.toMatchObject({
      code: "unsafe_address",
    });
    expect(setup.resolve).toHaveBeenNthCalledWith(1, "example.test");
    expect(setup.resolve).toHaveBeenNthCalledWith(2, "internal.test");
    expect(setup.request).toHaveBeenCalledTimes(1);
  });

  test("caps redirect hops", async () => {
    const setup = harness({
      replies: Array.from({ length: 4 }, (_, index) => ({
        statusCode: 302,
        headers: { location: `/hop-${index + 1}` },
        bytesRead: 0,
      })),
    });

    await expect(
      fetchSafeUrl("https://example.test/start", { ...setup, maxRedirects: 3 }),
    ).rejects.toMatchObject({ code: "too_many_redirects" });
    expect(setup.request).toHaveBeenCalledTimes(4);
  });

  test("caps response bytes", async () => {
    const setup = harness({
      replies: [{ statusCode: 200, headers: { "content-type": "text/html" }, bytesRead: 101 }],
    });

    await expect(
      fetchSafeUrl("https://example.test", { ...setup, maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  test("rejects unsupported response content types", async () => {
    const setup = harness({
      replies: [{ statusCode: 200, headers: { "content-type": "application/octet-stream" }, bytesRead: 10 }],
    });

    await expect(fetchSafeUrl("https://example.test", setup)).rejects.toMatchObject({
      code: "unsupported_content_type",
    });
  });

  test("rejects a final response without an allowed content type", async () => {
    const setup = harness({
      replies: [{ statusCode: 200, headers: {}, bytesRead: 10 }],
    });

    await expect(fetchSafeUrl("https://example.test", setup)).rejects.toMatchObject({
      code: "unsupported_content_type",
    });
  });

  test("includes DNS resolution in the five-second total timeout", async () => {
    vi.useFakeTimers();
    const setup = harness();
    setup.resolve.mockImplementation(
      () => new Promise(() => undefined),
    );
    const rejection = expect(
      fetchSafeUrl("https://example.test", setup),
    ).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(setup.request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("aborts a request at the five-second per-hop timeout", async () => {
    vi.useFakeTimers();
    const setup = harness({
      request: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")));
        }),
    });
    const rejection = expect(
      fetchSafeUrl("https://example.test", setup),
    ).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    vi.useRealTimers();
  });
});
