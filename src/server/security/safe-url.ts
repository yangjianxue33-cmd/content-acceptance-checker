import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5_000;
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "text/plain",
  "application/xhtml+xml",
]);

export type SafeUrlErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_not_allowed"
  | "unsafe_hostname"
  | "nonstandard_port"
  | "dns_failed"
  | "unsafe_address"
  | "network_error"
  | "invalid_redirect"
  | "too_many_redirects"
  | "response_too_large"
  | "unsupported_content_type"
  | "timeout";

export class SafeUrlError extends Error {
  constructor(public readonly code: SafeUrlErrorCode) {
    super("URL could not be checked safely");
    this.name = "SafeUrlError";
  }
}

type ResolvedAddress = { address: string; family: 4 | 6 };
type TransportResponse = {
  statusCode: number;
  headers?: Record<string, string | undefined>;
  bytesRead?: number;
};

type RequestInput = {
  url: URL;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
  maxBytes: number;
};

type SafeUrlDependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (input: RequestInput) => Promise<TransportResponse>;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  totalTimeoutMs?: number;
};

export type SafeUrlResult = {
  url: string;
  statusCode: number;
  result: "reachable" | "http_error";
  reasonCode: "http_error" | null;
};

function ipv4Bytes(address: string) {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function isPublicIpv4(address: string) {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicAddress(address: ResolvedAddress) {
  return address.family === 4 && isPublicIpv4(address.address);
}

function validateUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeUrlError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeUrlError("unsupported_protocol");
  }
  if (url.username || url.password) {
    throw new SafeUrlError("credentials_not_allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeUrlError("unsafe_hostname");
  }
  if (url.port) throw new SafeUrlError("nonstandard_port");
  url.hash = "";
  return { url, hostname };
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  try {
    return (await dnsLookup(hostname, { all: true, verbatim: true })).map(
      ({ address, family }) => ({ address, family: family as 4 | 6 }),
    );
  } catch {
    throw new SafeUrlError("dns_failed");
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function defaultRequest(input: RequestInput): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const requester = input.url.protocol === "https:" ? https : http;
    const request = requester.request(
      input.url,
      {
        method: "GET",
        headers: {
          Host: input.url.host,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "User-Agent": "ContentAcceptanceChecker/1.0 citation-validator",
        },
        signal: input.signal,
        servername: input.url.hostname.replace(/^\[|\]$/g, ""),
        lookup: (_hostname, _options, callback) =>
          callback(null, input.address, input.family),
      },
      (response) => {
        let bytesRead = 0;
        const declaredLength = Number(headerValue(response.headers["content-length"]));
        if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
          response.destroy();
          reject(new SafeUrlError("response_too_large"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          bytesRead += chunk.byteLength;
          if (bytesRead > input.maxBytes) {
            response.destroy(new SafeUrlError("response_too_large"));
          }
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: {
              location: headerValue(response.headers.location),
              "content-type": headerValue(response.headers["content-type"]),
            },
            bytesRead,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function requestWithTimeout(
  request: (input: RequestInput) => Promise<TransportResponse>,
  input: Omit<RequestInput, "signal">,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return request({ ...input, signal: controller.signal })
    .catch((error: unknown) => {
      if (error instanceof SafeUrlError) throw error;
      if (controller.signal.aborted) throw new SafeUrlError("timeout");
      throw new SafeUrlError("network_error");
    })
    .finally(() => clearTimeout(timeout));
}

function resolveWithTimeout(
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  hostname: string,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    resolve(hostname),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new SafeUrlError("timeout")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

export async function fetchSafeUrl(
  rawUrl: string,
  dependencies: SafeUrlDependencies = {},
): Promise<SafeUrlResult> {
  const resolve = dependencies.resolve ?? defaultResolve;
  const request = dependencies.request ?? defaultRequest;
  const maxBytes = dependencies.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = dependencies.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const perHopTimeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + (dependencies.totalTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  let current = rawUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const { url, hostname } = validateUrl(current);
    let addresses: ResolvedAddress[];
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new SafeUrlError("timeout");
      addresses = await resolveWithTimeout(resolve, hostname, remainingMs);
    } catch (error) {
      if (error instanceof SafeUrlError) throw error;
      throw new SafeUrlError("dns_failed");
    }
    if (addresses.length === 0) throw new SafeUrlError("dns_failed");
    if (addresses.some((address) => !isPublicAddress(address))) {
      throw new SafeUrlError("unsafe_address");
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new SafeUrlError("timeout");
    const pinned = addresses[0];
    const response = await requestWithTimeout(
      request,
      { url, address: pinned.address, family: pinned.family, maxBytes },
      Math.min(perHopTimeoutMs, remainingMs),
    );
    if ((response.bytesRead ?? 0) > maxBytes) {
      throw new SafeUrlError("response_too_large");
    }

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers?.location;
      if (!location) throw new SafeUrlError("invalid_redirect");
      if (redirectCount >= maxRedirects) {
        throw new SafeUrlError("too_many_redirects");
      }
      try {
        current = new URL(location, url).toString();
      } catch {
        throw new SafeUrlError("invalid_redirect");
      }
      continue;
    }

    const contentType = response.headers?.["content-type"]
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new SafeUrlError("unsupported_content_type");
    }
    const reachable = response.statusCode >= 200 && response.statusCode < 400;
    return {
      url: url.toString(),
      statusCode: response.statusCode,
      result: reachable ? "reachable" : "http_error",
      reasonCode: reachable ? null : "http_error",
    };
  }
}
