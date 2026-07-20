import { type NextRequest, NextResponse } from "next/server";

import { createSecurityHeaders } from "@/server/security/security-headers";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const securityHeaders = createSecurityHeaders({
    production: process.env.NODE_ENV === "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    nonce,
  });
  const contentSecurityPolicy = securityHeaders.find(
    ({ key }) => key === "Content-Security-Policy",
  )?.value;
  if (!contentSecurityPolicy) {
    throw new Error("Content Security Policy was not generated");
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  for (const { key, value } of securityHeaders) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
