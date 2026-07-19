import { describe, expect, it } from "vitest";

import { createSecurityHeaders } from "@/server/security/security-headers";

describe("createSecurityHeaders", () => {
  it("returns restrictive headers compatible with self-hosted Next assets", () => {
    const headers = Object.fromEntries(
      createSecurityHeaders({
        production: false,
        supabaseUrl: "http://127.0.0.1:54321/rest/v1",
      }).map(({ key, value }) => [key, value]),
    );

    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(headers["Content-Security-Policy"]).toContain(
      "connect-src 'self' http://127.0.0.1:54321",
    );
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS and omits unsafe-eval in production", () => {
    const headers = Object.fromEntries(
      createSecurityHeaders({
        production: true,
        nonce: "production-request-nonce",
      }).map(({ key, value }) => [key, value]),
    );

    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    const scriptDirective = headers["Content-Security-Policy"]
      .split("; ")
      .find((directive) => directive.startsWith("script-src"));
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).toContain(
      "'nonce-production-request-nonce'",
    );
    expect(scriptDirective).toContain("'strict-dynamic'");
  });

  it("fails closed when production headers are requested without a nonce", () => {
    expect(() => createSecurityHeaders({ production: true })).toThrow(
      "A CSP nonce is required in production",
    );
  });

  it("does not add malformed external origins to CSP", () => {
    const [{ value }] = createSecurityHeaders({
      production: false,
      supabaseUrl: "not a URL with a secret",
    });
    expect(value).not.toContain("not a URL");
  });
});
