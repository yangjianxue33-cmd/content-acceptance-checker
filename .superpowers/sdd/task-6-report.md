# Task 6 report

## Outcome

- Added a credential-free-testable GPTZero adapter for the verified `POST /v2/predict/text` contract. It uses `x-api-key`, optional model version, strict defensive response validation, explicit risk thresholds, a full-response timeout, and a 300-word `not_assessed` short circuit. Public/persisted results contain no raw probabilities, sentence highlights, or provider payloads.
- Added a pinned-address safe URL service. It permits only standard-port HTTP/HTTPS destinations resolving exclusively to public IPv4, rejects credentials/localhost/non-public IPv4/all IPv6 destinations, validates every DNS answer, pins the selected address while preserving Host/TLS SNI, re-resolves redirects, and caps redirects, bytes, content types, DNS/request/total time.
- Extended the Task 5 OpenAI Responses adapter with three separate strict schemas and independent `store: false` calls for brief fit, evidence/citations, and editorial quality. Article, brief, requirements, and citation text remain JSON-delimited untrusted data that cannot alter policy or schema.
- Added an idempotent four-module runner. Each module claims and updates exactly one `(review_id,module)` row; only queued/unavailable rows can be reclaimed, successful work is immutable, provider failures become safe `unavailable` results, citation failures remain module caveats, and one failed module does not discard the others.
- Added atomic service-role SQL boundaries for anonymous start, module claim/result persistence, and finalization, plus a private `citation_checks` metadata table. Mutating anonymous start checks the cookie HMAC under the parent-row lock. Citation rows store only normalized public URL, status/result category, and safe reason code; no fetched body is stored.
- Added finalization using the existing normalized scoring and recommendation rules. The SQL finalizer derives `completed|partial|failed` from the four persisted terminal module rows and enforces the two-completed-module minimum.
- Added import-safe Trigger.dev config/task with bounded exponential retries and a 300-second maximum duration. The payload schema is exactly `{ reviewId }`; credentials and private source are loaded only inside task execution.
- Added anonymous start/status routes with uniform missing/wrong/expired/deleted handling. Status exposes only safe aggregate state, four module labels/statuses, terminal/report readiness, and a report path.
- Added the responsive progress page/component with independent module tracks, exponential polling backoff, terminal/unmount/access-loss stop conditions, partial/unavailable states, idempotent retry, and fixed advisory authorship copy.
- Added the Task 6 migration, pgTAP coverage, regenerated Supabase types, and empty environment examples for Trigger project ref and optional GPTZero model version. Task 7/8 behavior was not implemented.

## RED/GREEN evidence

- GPTZero RED: targeted tests failed because `gptzero-provider` did not exist. GREEN: 15/15 contract, threshold, malformed payload, short-document, provider failure, and full-response timeout assertions passed.
- Safe URL RED: targeted tests failed because `safe-url` did not exist. Two later security REDs proved missing Content-Type was accepted and DNS resolution escaped the total timeout. GREEN: 37/37 protocol, address, pinning, rebinding, redirect, size, content-type, DNS, and request timeout assertions passed.
- Module runner/finalization RED: both modules were missing. GREEN: 10/10 idempotency, independent failure, citation safety, injection/schema, score normalization, recommendation priority, and stable terminal-state assertions passed.
- SQL RED: Task 6 pgTAP reported the missing table/functions and stopped after 11 assertions. A retry-state RED later proved partial reviews remained terminal before the worker could reclaim unavailable work. GREEN: the new 28 assertions passed; the full DB suite passed 140/140 after updating the existing all-child schema inventories.
- Route/Trigger RED: tests failed because start/status/task modules did not exist. GREEN: 7/7 cookie boundary, payload minimization, idempotent completed start, safe status, and injected-runner assertions passed.
- Progress RED: the component did not exist. A later RED proved invalid anonymous access continued polling. GREEN: 6/6 start, independent status, backoff, terminal stop, unmount cancellation, access-loss stop, partial state, advisory copy, and retry assertions passed.
- Final targeted Task 6 run: 7 files and 50/50 assertions passed with `pnpm typecheck` exit 0.

## Required gates

- `pnpm exec supabase db reset`: exit 0; all four migrations applied successfully.
- `pnpm exec supabase test db`: exit 0; 4 files and 140/140 pgTAP assertions passed.
- `pnpm exec supabase db lint`: exit 0; 0 schema errors.
- `pnpm vitest run`: exit 0; 19 files and 172/172 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 with 0 errors and 0 warnings after removing one unused test helper.
- `pnpm build`: exit 0; Next.js 16.2.10 production build completed and included dynamic start/status/progress routes without contacting Trigger.dev, OpenAI, or GPTZero.
- `git diff --check`: exit 0.

## Privacy, security, and scope verification

- No Task 6 production path logs article content, brief/requirement text, cookie tokens/hashes, provider bodies, sentence highlights, or raw probabilities.
- GPTZero errors and timeouts persist only safe error codes and `unavailable`; they never accuse authorship or force rejection.
- OpenAI and GPTZero construction occurs only during production task execution. Trigger task/config imports require no credentials and make no external call during tests/build.
- Safe URL requests never perform a DNS check followed by ordinary hostname fetch: the validated address is injected into the socket lookup callback for the actual request, with original Host and TLS SNI preserved.
- Anonymous mutations use the service-role start RPC, which locks the review row and compares the supplied HMAC before creating module rows. Missing, wrong, expired, and deleted reviews share the same public 404.
- Public status omits source text, brief/requirements excerpts, fetched pages, provider payloads, hashes, tokens, raw errors, and raw probabilities.
- Retry reuses the same review and unique module rows. Only queued/unavailable work can be claimed; completed/not-assessed modules are not rerun.
- No deterministic E2E provider wiring, report UI, decision workflow, or other Task 7/8 functionality was added.

## Review-fix follow-up (2026-07-19)

- Corrected the GPTZero response contract to require official lowercase `human`, `ai`, and `mixed` probability keys and lowercase confidence categories while retaining strict uppercase document classifications. `predicted_class` accepts the documented lowercase labels and uppercase classification labels; mapping uses only `class_probabilities.ai`, and persisted/public output still excludes raw probabilities and provider payloads.
- Isolated provider construction with independent factories and safe fallbacks. GPTZero initialization failure now affects only `ai_risk`; OpenAI initialization failure affects only `brief_fit`, `evidence_citations`, and `editorial_quality`. Every affected module is still claimed and persisted as terminal `unavailable`, so Trigger finalization continues.
- Replaced the incomplete IPv6 special-purpose deny table with the Alpha fail-closed boundary: every IPv6 destination is rejected, including otherwise-global IPv6. Validated public IPv4 addresses remain pinned to transport and redirects remain independently resolved and checked.
- Added forward migration `202607190002_harden_analysis_write_boundaries.sql`. Authenticated clients retain owner-scoped SELECT but no longer have INSERT/UPDATE/DELETE grants or mutation policies on `analysis_modules` and `issues`; service-role writes remain available.
- Review-fix RED evidence: official GPTZero fixtures produced 11 failures; provider isolation tests failed because the factory did not exist; four special-purpose IPv6 destinations were accepted; and pgTAP reported the three extra authenticated privileges on each output table. Each slice was made GREEN before continuing.
- Review-fix targeted gates: 4 files and 74/74 Vitest assertions passed; the new database boundary file passed 11/11 assertions.
- Review-fix full gates: database reset applied all five migrations; all 5 pgTAP files passed 151/151 assertions; DB lint returned zero findings; all 19 Vitest files passed 186/186 tests; typecheck, ESLint, production build, and `git diff --check` all exited 0.

## Final IPv6 re-review fix (2026-07-19)

- RED: `2620:4f:8000::1` and ordinary global IPv6 `2606:4700:4700::1111` were both accepted by the hand-maintained prefix classifier.
- GREEN: removed the IPv6 parser and prefix denylist; citation validation now accepts only DNS answers classified as public IPv4 and rejects every IPv6 answer with `unsafe_address`. DNS-all-answer validation, redirect revalidation, original-host TLS/HTTP handling, and pinned transport are unchanged.
- Gates: safe URL targeted tests passed 44/44; all 19 Vitest files passed 188/188 tests; typecheck, ESLint, production build, and `git diff --check` exited 0. Database files were untouched, so database gates were not rerun for this follow-up.
