# Alpha deployment controls

## Anonymous API rate limits

Apply rate limiting at the deployment gateway or reverse proxy. Do not use an
in-memory limiter inside Next.js because counters would diverge across instances
and reset on deploy.

Start with these per-source-IP limits and tune from aggregate gateway metrics:

| Route | Limit | Window |
| --- | ---: | ---: |
| `POST /api/reviews` | 10 requests | 10 minutes |
| `PUT /api/reviews/*/requirements` | 30 requests | 10 minutes |
| `POST /api/reviews/*/start` | 10 requests | 10 minutes |
| `POST /api/reviews/*/decision` | 30 requests | 10 minutes |
| `GET /api/reviews/*/status` | 120 requests | 10 minutes |

Return `429` with `Retry-After`. Trust forwarded client-IP headers only from the
configured gateway. Do not put request bodies, tokens, cookies, full URLs, or
raw IP addresses in application logs. If the gateway stores IP-based security
events, follow the hosting provider's access and retention controls.

## Required production boundaries

- Keep the `review-source` bucket private.
- Run the Trigger.dev `delete-expired-reviews` schedule in staging and
  production; it deletes expired storage objects before database rows and then
  performs a bounded orphan sweep.
- Leave `E2E_FAKE_ANALYSIS` unset in production. Startup and build fail closed
  if it is set to `true` while `NODE_ENV=production`.
- Provide Supabase, Trigger.dev, OpenAI, GPTZero, token-hash, and source-text
  encryption credentials through the hosting platform's secret store.
- Terminate TLS at the gateway so the production HSTS policy is valid.
