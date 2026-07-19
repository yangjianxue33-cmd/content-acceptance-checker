import type { NextConfig } from "next";

import { assertSafeFakeAnalysisEnvironment } from "./src/server/security/fake-analysis-guard.ts";

assertSafeFakeAnalysisEnvironment();

const nextConfig: NextConfig = {};

export default nextConfig;
