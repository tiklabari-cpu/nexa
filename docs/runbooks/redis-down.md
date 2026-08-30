# Runbook: Redis is down

## Symptom

- `GET /health/ready` answers `503` on `apps/api` and `apps/rtm` (both probe
  Redis — `apps/api/src/routes/health.ts`, `apps/rtm/test/integration/health.test.ts`).
- RTM message fan-out stops: `apps/rtm/src/fanout.ts` delivers exclusively via
  Redis per-license pub/sub channels, so there is no in-memory fallback —
  agents connected to any pod stop receiving new events.
- **Not everything fails the same way.** Read this before assuming a total
  outage:
  - The REST/RTM rate limiters **fail open** — `apps/api/src/plugins/rate-limit.ts`
    (`"Redis being unavailable must not take the API down with it. Fail
open"`). Requests keep being served without rate-limit enforcement; this
    is deliberate (availability over a perfectly enforced quota).
  - SAML SSO login **fails closed**. The assertion-replay guard
    (`apps/api/src/lib/saml.ts`, `createRedisReplayGuard`) throws when Redis
    is unreachable, and the caller lets it — accepting SSO logins during a
    Redis outage would be an authentication bypass with a known start time.
    Password-based login is unaffected (it doesn't touch this guard). So an
    SSO-only outage report during a Redis incident is expected behavior, not
    a second bug — do not try to "fix" it by bypassing the guard.

## Diagnosis

1. Confirm readiness is failing on the Redis leg specifically (admin bearer
   token, `apps/api/src/routes/health.ts`):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/v1/health/ready  # 503
   # with an admin bearer token, GET /api/v1/health -> dependencies.redis.status/.error
   ```

2. Check the container:

   ```bash
   docker compose ps redis
   docker compose logs --tail=100 redis
   docker compose exec redis redis-cli ping           # expect PONG
   # demo stack:
   docker compose -f docker-compose.full.yml ps redis
   docker compose -f docker-compose.full.yml exec redis redis-cli ping
   ```

3. If SSO logins are being refused, that alone is not evidence of a wider
   problem — confirm it's the replay guard and not something else by checking
   whether password-based agent login still works (`POST /auth/login`) while
   `POST /auth/sso/*` fails.

## Response

- Same as Postgres: readiness already pulled the instance(s) out of rotation;
  once Redis answers again the next readiness probe passes on its own.
- Restart/repair the container if it's the problem:

  ```bash
  docker compose restart redis        # dev stack
  docker compose -f docker-compose.full.yml restart redis   # demo stack
  ```

- Do not attempt to route around the SAML replay guard's fail-closed behavior
  (e.g. by disabling it) to "restore" SSO during the outage — that reopens
  exactly the assertion-replay window the guard exists to close. SSO recovers
  on its own once Redis is back; there is no supported workaround.
- The rate limiter's fail-open window means the usual per-agent/per-customer
  throttles are not enforced while Redis is down — if the outage coincides
  with unusually high traffic, watch for abuse rather than assuming the limits
  are still protecting the API.

## After

- Confirm `/health/ready` is `200` again on every instance.
- If the outage was long enough for the rate limiter to matter, check whether
  any abuse happened during the fail-open window (there is no separate audit
  trail for "rate limit was unenforced" — this is a traffic-pattern review,
  not a log query).
- If SSO logins were refused, no action is needed once Redis recovers — the
  replay guard resumes normal operation on the next login attempt. There is
  no backlog of refused SSO attempts to reprocess; the caller's browser simply
  retries.
