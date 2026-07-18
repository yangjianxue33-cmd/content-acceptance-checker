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
- `pnpm test:db`: exit 0; 3 files and 106/106 pgTAP assertions passed.
- `pnpm exec supabase db lint --local`: exit 0; 0 schema errors.
- `pnpm vitest run`: exit 0; 12 files and 94/94 tests passed after the final production change.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 with 0 errors and 0 warnings.
- `pnpm build`: exit 0; Next.js 16.2.10 production build completed with dynamic `/review/brief-confirmation` and `/api/reviews/[id]/requirements` routes.
- `git diff --check`: exit 0.

## Privacy and scope verification

- Production Task 5 code contains no `console` logging and sends no article text, complete brief text, token, or token hash in JSON, URLs, client props, provider metadata, or errors.
- Only editable requirement text and intentionally cited source excerpts are passed to the client editor.
- Provider requests delimit article and brief text as untrusted data and explicitly prohibit following embedded instructions.
- `.env.example` already contained empty placeholders for `OPENAI_API_KEY` and `OPENAI_ANALYSIS_MODEL`; no environment-file change was needed.
