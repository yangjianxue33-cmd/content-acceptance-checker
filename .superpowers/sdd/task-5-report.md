# Task 5 report

## Outcome

- Added a strict `StructuredWritingAnalyzer` contract and OpenAI Responses adapter using the installed SDK's `zodTextFormat`, a strict Zod schema, `store: false`, `OPENAI_ANALYSIS_MODEL`, and an injected fake client for credential-free tests.
- Added server-only anonymous ownership verification from the HttpOnly `anonymous_review_access` cookie, HMAC comparison against the stored hash, uniform missing/wrong/expired handling, private brief download, and server-side article decryption.
- Persisted first-load extracted drafts and reused them on refresh. Reviews without a brief skip extraction and continue to `/review/progress/<id>` with no synthetic requirements.
- Added a service-role-only `replace_review_requirements` RPC. It locks the review row, atomically replaces draft or confirmed sets, advances confirmation exactly once, and preserves the first set on divergent retries after the review is queued.
- Added same-route GET/PUT handlers and a server-loaded English confirmation page with keyboard editing, category/text changes, add/delete, critical toggles, read-only source excerpts, save-error announcements, focus preservation, and double-submit prevention.
- Removed the raw anonymous token from the review-creation JSON DTO; it remains only in the required HttpOnly, Secure, SameSite=Lax cookie boundary.
- Task 6 analysis execution was not implemented.

## RED/GREEN evidence

- OpenAI adapter RED: the targeted suite failed because `openai-analyzer` did not exist. A second RED proved an empty requirement set incorrectly resolved to `[]`. GREEN: 11/11 adapter assertions passed.
- Confirmation service RED: the targeted suite failed because `confirm-requirements` did not exist. GREEN: 10/10 ownership, expiry, private-source, draft-reuse, no-brief, editing, and divergent retry assertions passed.
- RPC RED: Task 5 pgTAP reported the missing `replace_review_requirements` function and 16 failed assertions before migration. GREEN: 19/19 targeted pgTAP assertions passed after the migration.
- Route RED: the confirmation suite failed because the requirements route did not exist. GREEN: the expanded service/route suite passed 15/15.
- Editor RED: the component suite failed because `requirements-editor` did not exist. After correcting test isolation, the remaining source-reference behavior failed as expected. GREEN: 6/6 editor assertions passed.
- Token boundary RED: the review-creation route test received `accessToken` in JSON when the expected public DTO omitted it. GREEN: the creation and intake regression slice passed 23/23 after removing that field.
- Final targeted Task 5 run: 3 files, 32/32 Vitest assertions passed with `pnpm typecheck` exit 0.

## Required gates

- `pnpm exec supabase db reset`: exit 0; all three migrations applied successfully.
- `pnpm test:db`: exit 0; 3 files and 112/112 pgTAP assertions passed after the independent-review fixes.
- `pnpm exec supabase db lint --local`: exit 0; 0 schema errors.
- `pnpm vitest run`: exit 0; 12 files and 97/97 tests passed after the independent-review fixes.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 with 0 errors and 0 warnings.
- `pnpm build`: exit 0; Next.js 16.2.10 production build completed with dynamic `/review/brief-confirmation` and `/api/reviews/[id]/requirements` routes.
- `git diff --check`: exit 0.

## Privacy and scope verification

- Production Task 5 code contains no `console` logging and sends no article text, complete brief text, token, or token hash in JSON, URLs, client props, provider metadata, or errors.
- Only editable requirement text and intentionally cited source excerpts are passed to the client editor.
- Provider requests carry article and brief text as JSON-escaped UTF-8 string fields in one strict envelope; instructions classify the complete fields as untrusted data and prohibit following embedded instructions.
- `.env.example` already contained empty placeholders for `OPENAI_API_KEY` and `OPENAI_ANALYSIS_MODEL`; no environment-file change was needed.

## Independent review follow-up

- Replaced escapable XML-like prompt delimiters with a deterministic JSON envelope containing JSON-escaped UTF-8 article/brief fields. Adversarial tests include closing tags, role-shaped JSON, and injection text; they prove the request remains exactly one system message plus one user message while preserving the source text losslessly for analysis and exact excerpts.
- Extended `replace_review_requirements` with `p_access_token_hash`. The service derives the HMAC and passes only that hash to the repository/RPC; the raw cookie token never reaches Postgres.
- The RPC now locks the parent row, then checks existence, hash equality, and `delete_at > now()` before idempotent return, payload validation, deletion, insertion, or status transition. Missing, wrong, and expired access all raise the same safe `P0001: review_access_denied`, which the route maps through `RequirementsAccessError` to the existing generic 404 response.
- Added service regressions for revocation/expiry between initial load and atomic replacement, plus pgTAP assertions for wrong hash, expired review, missing review, unchanged requirements, and unchanged status.
- Review-fix RED/GREEN: prompt tests failed 2/12 before framing changes and passed 12/12 after; service tests failed 5/17 before atomic hash propagation/error preservation and passed 17/17 after; Task 5 pgTAP failed on the missing four-argument RPC and passed 25/25 after migration changes.
- Review-fix targeted gate: 3 files and 35/35 Vitest assertions passed with typecheck exit 0. Full gates: DB reset passed; pgTAP 112/112; DB lint clean; Vitest 97/97; typecheck, ESLint, production build, and diff check all passed.
