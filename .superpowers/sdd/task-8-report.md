# Task 8 Report — Alpha safety controls and release gate

Date: 2026-07-19

## Delivered

- Added allowlist-only aggregate retention logging. Unknown events are rejected;
  unknown metadata and invalid approved values are dropped without traversing or
  serializing nested payloads.
- Added two-pass retention cleanup: known expired review objects are removed
  before their database rows, and old UUID-prefixed storage orphans are swept
  with bounded pagination while young and unknown-format objects are retained.
  The private bucket stores an opaque maintenance cursor so later scheduled runs
  continue where the previous bounded scan ended.
- Added the hourly Trigger.dev cleanup task with bounded retry and aggregate-only
  completion/failure records.
- Added CSP, frame, content-type, referrer, permissions, and production HSTS
  headers to product and API responses. Production pages render dynamically so
  each response can apply one request nonce to both CSP and Next bootstrap scripts.
- Added deterministic non-production analysis adapters. They use the production
  schemas, module persistence, and report finalization path. A production build
  with `E2E_FAKE_ANALYSIS=true` fails before compilation.
- Added browser acceptance coverage for AT-01 through AT-08, AT-19, and AT-22,
  including storage-first expiry cleanup and wrong-token access denial.
- Prevented a pre-hydration brief-confirmation submit from losing its review ID.
- Documented deployment-gateway rate limiting in `docs/deployment-alpha.md`;
  no unreliable per-instance in-memory limiter or paid service was introduced.

## Deterministic release evidence

- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm vitest run --coverage --maxWorkers=1`: 28 files, 251 tests, no skips.
  Coverage: statements 71.20%, branches 63.53%, functions 65.84%, lines 73.68%.
- `pnpm supabase db reset --local`: passed with all migrations reapplied.
- `pnpm test:db`: 6 files, 169 pgTAP tests, all passed.
- `pnpm supabase db lint`: no schema errors.
- `pnpm exec playwright test --workers=1 --reporter=line`: 9 browser tests,
  all passed with no skips and no live provider calls.
- `pnpm build`: passed and generated all product and API routes.
- Production server CSP smoke check: `/review` returned 200; response and Next
  scripts shared the same nonce, production `script-src` omitted
  `unsafe-inline`, and HSTS was present.
- Production fake-analysis build guard: rejected as expected before compilation.
- Authored-file incomplete-marker scan: no incomplete markers after removing
  obsolete input-placeholder styling and attributes.
- AI-risk copy review: rendered product output remains advisory, does not claim
  authorship or misconduct, and does not auto-reject content.
- Independent Task 8 review: two Important findings were fixed in `43c3b63`;
  the follow-up review returned `APPROVED` with no remaining Critical or
  Important findings.

## External release blocker

OpenAI, GPTZero, Trigger.dev, and a protected staging target are not configured
in the current environment. Therefore the three approved real-provider staging
fixtures were not run and are not claimed as passed. This is the only remaining
external Alpha release validation; all deterministic local gates are complete.
