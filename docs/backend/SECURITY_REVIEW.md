# Phase 13.6 — Security & Abuse Readiness

Reviewed on branch `feature/phase-13-production-readiness`. Findings are labelled
AUTOMATED (test-backed), CODE-REVIEW (verified by reading current code), or OPEN.

## 1. Tenant isolation & proxy protection

- Every tenant API root (`/api/ai`, `/api/lists`, `/api/templates`,
  `/api/campaigns`, `/api/contacts`, `/api/profile`) and nested route is matched
  by the proxy (`src/proxy.ts`). `tests/proxy-coverage.test.mjs` fails if a
  tenant root is added without a matcher — AUTOMATED.
- The proxy authenticates via JWT and **overwrites** any client-supplied
  `x-workspace-id` with the verified workspace before forwarding
  (`src/lib/proxy-auth.ts`); route handlers read workspace only from that header
  and validate it as a positive integer (`getWorkspaceIdFromHeaders`).
  `tests/proxy-auth.test.mjs` + E2E stage-2 confirm spoof replacement — AUTOMATED.
- RLS with `FORCE ROW LEVEL SECURITY` enforces isolation even for the table
  owner; the app runs as a non-superuser role. Cross-tenant select/update/delete/
  relation and spoofed/missing context are rejected —
  `tests/tenant-isolation.integration.test.mjs` — AUTOMATED.

## 2. Authentication

- JWT signed/verified with `jose` (`src/lib/auth.ts`); payload restricted to
  positive-integer `userId`/`workspaceId`. Auth cookie is read server-side.
- Cookie flags, logout invalidation, and token expiry: CODE-REVIEW confirms
  server-side cookie usage and a logout route; full production cookie-flag and
  expiry behavior under HTTPS is **OPEN** (browser/e2e verification not executed).
- Account-existence leakage: login/register/OTP responses were reviewed for
  uniform messaging. CODE-REVIEW — no obvious enumeration in the reviewed
  handlers; a dedicated timing/enumeration test is **OPEN**.

## 3. Cron protection

- `src/lib/cron-auth.ts` uses a timing-safe comparison and **fails closed in
  production** (503 when `CRON_SECRET` is unset; 401 on mismatch).
  `tests/cron-auth.test.mjs` — AUTOMATED.

## 4. Input limits & injection safety

- All SQL uses parameterized placeholders; `executeQuery` rejects any SQL text
  containing `${` or backticks (`src/lib/db.ts`) — CODE-REVIEW/AUTOMATED via the
  existing suite.
- Filter keys are whitelisted/validated (`src/lib/campaign-filters.ts`); dynamic
  JSONB keys are matched against a strict pattern.
- Request-size / field-length limits for large JSON/HTML inputs are **OPEN** —
  there is no explicit body-size cap in the handlers; recommend enforcing a body
  size limit at the deployment edge and adding field-length validation for
  template HTML.

## 5. Secret handling & log redaction

- `.gitignore` covers `.env*` (except `.env.example`); `.env` is not tracked; no
  secret patterns found in `src`/`scripts` — AUTOMATED (scan).
- Redaction: `src/lib/worker-log.ts` (structured JSON, no raw stacks, secret
  sanitizer — `tests/worker-log.test.mjs`), `src/lib/mail/nodemailer.ts`
  (`sanitizeMailError` strips SMTP user/pass), `src/lib/ai/gemini.ts` (strips API
  keys), `src/lib/db.ts` (masks connection-string password) — AUTOMATED/CODE-REVIEW.
- `src/lib/env-preflight.ts` reports config problems by name/shape only, never
  value — `tests/env-preflight.test.mjs` asserts no secret leaks — AUTOMATED.

## 6. Dependency & secret scan (triage)

`npm audit` (2026-07): 6 advisories (1 high, 5 moderate). Per policy, breaking
upgrades were **not** blindly applied.

| Advisory | Severity | Reachable? | Triage |
|---|---|---|---|
| nodemailer — message-level `raw` bypasses `disableFileAccess`/`disableUrlAccess` | HIGH | **No** — the send path (`sendEmail`) never accepts/forwards a `raw` option and always sets both flags | Not exploitable in current usage. Plan upgrade to nodemailer 9 (breaking) as follow-up. |
| postcss — XSS via unescaped `</style>` in CSS stringify | MODERATE | Build-time only (bundler), not a runtime tenant vector | Track; upgrade with the Next toolchain. |
| next — depends on vulnerable postcss | MODERATE | Transitive of the above | Bundled; upgrade with Next. |
| dompurify — `ALLOWED_ATTR` pollution via `setConfig` | MODERATE | Only via `swagger-ui-react` on `/api-docs` | Track; consider gating `/api-docs` in production. |
| js-yaml — quadratic-complexity DoS | MODERATE | Only via `swagger-ui-react` on `/api-docs` | Same as above. |
| swagger-ui-react — transitive js-yaml | MODERATE | `/api-docs` only | Same as above. |

No reachable high-severity auth bypass, tenant leak, secret leak, or cron
exposure remains open.

## 7. Rate limiting (deployment requirement / BLOCKER)

No shared-store rate limiter exists for `login`, `registration`/`OTP`, Gemini
endpoints, or `cron`. An in-memory limiter would not hold under horizontal
scaling and is **not** claimed. **Requirement:** enforce rate limiting at the
deployment edge (reverse proxy / WAF / platform) or introduce a shared store
(e.g. Redis) before exposing these endpoints to untrusted traffic. Until then
this is a launch **BLOCKER** for public exposure.

## 8. Unsubscribe / legal / suppression decision

No first-class unsubscribe or suppression list is implemented; template copy
alone does not satisfy bulk-email compliance. **Decision recorded:** acceptable
only for controlled, opt-in recipient sets; a first-class unsubscribe +
suppression mechanism must be built before general/marketing bulk sending.
BLOCKER for compliant public launch.

## 9. Open security items (not claimed complete)

- Request body-size cap + template HTML field-length limits.
- Production cookie-flag/expiry and account-enumeration/timing verification.
- Shared-store or edge rate limiting.
- First-class unsubscribe/suppression.
