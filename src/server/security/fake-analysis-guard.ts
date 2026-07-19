type FakeAnalysisEnvironment = {
  nodeEnv?: string;
  fakeAnalysis?: string;
};

function currentEnvironment(): FakeAnalysisEnvironment {
  return {
    nodeEnv: process.env.NODE_ENV,
    fakeAnalysis: process.env.E2E_FAKE_ANALYSIS,
  };
}

export function assertSafeFakeAnalysisEnvironment(
  environment: FakeAnalysisEnvironment = currentEnvironment(),
) {
  if (
    environment.nodeEnv === "production" &&
    environment.fakeAnalysis === "true"
  ) {
    throw new Error("E2E_FAKE_ANALYSIS must never be enabled in production");
  }
}

export function isFakeAnalysisEnabled(
  environment: FakeAnalysisEnvironment = currentEnvironment(),
) {
  assertSafeFakeAnalysisEnvironment(environment);
  return (
    environment.nodeEnv !== "production" && environment.fakeAnalysis === "true"
  );
}
