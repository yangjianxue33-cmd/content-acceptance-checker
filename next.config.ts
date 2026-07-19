import type { NextConfig } from "next";

import { assertSafeFakeAnalysisEnvironment } from "./src/server/security/fake-analysis-guard.ts";
import { createSecurityHeaders } from "./src/server/security/security-headers.ts";

assertSafeFakeAnalysisEnvironment();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: createSecurityHeaders({
          production: process.env.NODE_ENV === "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
};

export default nextConfig;
