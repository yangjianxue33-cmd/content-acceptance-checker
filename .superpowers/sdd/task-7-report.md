# Task 7 report

## Outcome

- Added an explicit public report DTO and production query boundary for anonymous reviews. The server verifies the HttpOnly cookie HMAC and unexpired retention boundary before reading child rows; missing, wrong, expired, and deleted access share one generic not-found error.
- Stable `completed`, `partial`, and `failed` states render reports. Authenticated nonterminal reads return only `/review/progress/:id`, without loading module, requirement, issue, or decision data.
- Public report data includes only title/content type/word count, terminal state, optional normalized score and recommendation, four public module results, confirmed requirement evaluations, bounded issue context, and the recorded editor decision. It excludes encrypted source, filenames/paths, tokens/hashes, delete timestamps, provider errors/payloads, raw probability, and internal IDs.
- Added deterministic issue ordering by severity, module, source position, creation time, and private tie-break ID. Public excerpts are capped at 320 characters, explanations at 600, actions at 400, with bounded summaries, caveats, requirements, and title.
- Enforced safe AI-writing-risk language at the DTO boundary. High risk always requires `manual review`; every public module caveat is checked for accusatory claims, and every low/medium/high AI-risk issue receives fixed advisory-safe explanation/action copy. AI-risk critical findings are defensively downgraded to major in addition to the database constraint.
- Added the atomic `set_anonymous_review_decision` service-role RPC. It locks the review, rechecks anonymous HMAC, expiry, and terminal state, accepts only the existing three-value enum, and performs an idempotent upsert. Repeating the same value preserves its audit timestamp; a changed value is last-write-wins with a server timestamp.
- Added a generic PUT decision route with exact-value validation, cookie-only access, safe 400/404/500 responses, and no token or review data outside the existing UUID path.
- Resolved the Task 6 path mismatch by standardizing completed/partial/failed report links on `/report/:id`. Failed terminal reviews now expose the safe no-score report as well as retry guidance.
- Added a responsive English report page in the existing ink/paper/cobalt proof-slip language. The normalized score, system recommendation, and editor decision are separate regions; modules expose explicit unavailable/not-assessed labels and caveats; issues are grouped by textual severity with read-only bounded excerpts.
- Added native keyboard-operable decision radios/button, live save status and error announcements, heading hierarchy, textual status/severity labels, and the fixed disclaimer: “Results are advisory, do not prove authorship or misconduct, and final approval stays with the editor.”
- Issue-usefulness controls were intentionally omitted because persistence would expand the requested decision API. No Task 8, billing, sharing, comments, teams, or export behavior was added.

## RED/GREEN evidence

- Report/decision service RED: both targeted suites failed because `get-report` and `set-decision` did not exist. GREEN: complete, partial, failed/no-score, nonterminal, HMAC access, expiry, deterministic ordering, bounded DTO, exact three-value decisions, and idempotency tests passed.
- Database RED: the new pgTAP file reported the missing RPC/privileges and stopped when the absent function was invoked. GREEN: all 18 Task 7 assertions passed for function privileges, exact enum labels, wrong/expired/nonterminal denial, all three values, last-write-wins, server timestamps, idempotency, unique row persistence, and direct-anon denial.
- Route/path RED: the decision route import was missing and the completed start route still returned `/review/report/:id`. GREEN: decision validation/access/error tests and the standardized `/report/:id` progress/start behavior passed.
- UI RED: the report component suite failed because the four components did not exist. The first GREEN pass surfaced accessible-name mismatches for severity regions and radio labels; component semantics were corrected and all seven UI tests passed.
- AI wording RED: an unsafe high-risk caveat containing rejection/cheating/authorship-proof language crossed the initial DTO. GREEN: high-risk caveats are replaced with fixed manual-review-only language before rendering.
- Final Task 7 targeted run: 3 files and 31/31 assertions passed.

## Required gates

- `pnpm exec supabase db reset`: exit 0; all six migrations applied, including `202607190003_task7_report_decisions.sql`.
- `pnpm exec supabase test db`: exit 0; 6 files and 169/169 pgTAP assertions passed.
- `pnpm exec supabase db lint`: exit 0; 0 schema errors.
- `pnpm vitest run`: exit 0; 22 files and 223/223 tests passed after the independent-review fixes.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 with 0 errors and 0 warnings.
- `pnpm build`: exit 0; Next.js 16.2.10 production build completed and emitted dynamic `/report/[id]` and `/api/reviews/[id]/decision` routes.
- Staged `git diff --check`: exit 0.

## Privacy, security, and scope verification

- Sensitive payload/path scan found no raw probability, provider payload, encrypted source, original filename, object path, or private database detail in Task 7 production files.
- Fake-production-adapter scan found no mocks, fixtures, stubs, fake/deterministic adapters, random results, or example-result wiring in Task 7 production files.
- Public-output tests verify that prohibited proof/cheating/misconduct/rejection claims cannot cross module caveats or AI-risk issue explanation/action fields; the fixed non-accusatory disclaimer remains unchanged.
- The only token hash and expiry fields selected are held inside the service-only authentication boundary and are omitted from the public DTO. Child report rows are not queried until that boundary passes.
- The decision mutation is atomic in PostgreSQL and executable only by `service_role`; anon clients cannot invoke the RPC or query the decision table directly.
- Source context has no expansion control and remains bounded/read-only. Provider error codes, citation fetch bodies, file metadata, retention timestamps, and internal IDs never enter rendered props or route responses.

## Independent review fixes (2026-07-19)

- Added route-level `z.uuid()` validation before decision-body parsing and before the service/RPC boundary. Invalid route IDs now return generic `400 { "error": "Invalid request." }` and never call the injected decision service.
- Extended public wording safety beyond high AI risk. Low, medium, and high AI-risk issue explanations now use fixed advisory copy; low/medium actions require editorial-context review while high-risk actions retain explicit manual-review wording.
- Added one public caveat neutralizer for all four modules. Caveats containing proof/proving, cheating, misconduct, or rejection language are replaced with a bounded advisory-safe fallback; already-safe caveats remain useful and unchanged.
- Non-AI editorial issue explanations and suggested actions are not passed through the AI safety replacement and remain intact.
- RED evidence: invalid UUID reached the service and returned 500 before route validation; low/medium unsafe AI issue text and unsafe non-AI caveats crossed the initial DTO unchanged. Each focused test failed for that expected behavior before production changes.
- GREEN evidence: decision suite passed 15/15; focused wording tests passed 4/4; combined report/decision/route/UI targeted run passed 40/40.
- Follow-up gates: full Vitest passed 22 files and 223/223 tests; typecheck, ESLint, Next.js production build, and `git diff --check` exited 0. Database files were untouched, so database gates were not rerun.
