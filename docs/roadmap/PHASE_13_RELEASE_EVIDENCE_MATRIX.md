# Phase 13 — Release Evidence Matrix

Status legend: **AUTOMATED** (executable test/harness) · **CODE-REVIEW** (verified
by reading current code, no runtime execution) · **MANUAL-OPEN** (requires human
run not yet performed) · **DEFERRED** (explicitly out of the MVP release claim)
· **BLOCKER** (must be resolved or accepted before public launch).

All evidence below was produced from the current branch
`feature/phase-13-production-readiness`. Automated evidence was executed against
Node 24 and a disposable PostgreSQL 16 database.

## 1. Release claims → evidence

| MVP claim | Evidence | Owner phase | Status |
|---|---|---|---|
| Multi-tenant isolation via PostgreSQL RLS | `tests/tenant-isolation.integration.test.mjs` — 2 workspaces, restricted non-superuser role, select/update/delete/relation isolation, spoofed + missing context rejected, FORCE RLS asserted | 13.2 | AUTOMATED |
| Schema init is idempotent & non-destructive | `tests/schema-idempotency.integration.test.mjs` — empty DB, `scripts/apply-schema.mjs` run twice in separate processes, sentinel row survives, FORCE RLS on all tenant tables | 13.2 | AUTOMATED |
| Atomic campaign claim, no duplicate sends, stale-lease recovery | `tests/worker-delivery.integration.test.mjs` — concurrent claims → exactly one owner; draft/future never claimed; fresh lease not re-claimable; stale lease reclaimed; one log per recipient | 13.3 | AUTOMATED |
| Delivery outcome correctness (zero recipients, missing template, SMTP unconfigured, all-success/failed/mixed, AI fallback) | Unit: `tests/campaign-status.test.mjs`, `tests/personalization.test.mjs`, `tests/mail.test.mjs`, `tests/worker-log.test.mjs` (already present) + integration delivery path | 13.3 | AUTOMATED |
| End-to-end builder → draft → schedule → worker → SMTP → logs | `scripts/run-e2e-smoke.mjs` (`npm run smoke:e2e`) — real proxy auth, real builder→draft contract, real claim SQL, real Nodemailer SMTP transport to `scripts/lib/smtp-capture.mjs`, verified with the email-logs route SQL/transform | 13.4 | AUTOMATED (controlled provider) |
| Live Gemini + live SMTP delivery | `npm run smoke:live` (opt-in, requires real keys) | 13.4 | MANUAL-OPEN |
| JWT proxy replaces spoofed `x-workspace-id` | `tests/proxy-auth.test.mjs`, `tests/proxy-coverage.test.mjs` + E2E stage-2 (spoofed header overwritten) | 13.6 | AUTOMATED |
| Cron worker fails closed in production | `tests/cron-auth.test.mjs` + `src/lib/cron-auth.ts` (503 when unset in prod, timing-safe compare) | 13.5/13.6 | AUTOMATED + CODE-REVIEW |
| Production config fails closed | `tests/env-preflight.test.mjs` + `src/lib/env-preflight.ts` (12 cases: weak/missing/insecure secrets, SSL, SMTP, Gemini), wired into startup via `instrumentation.ts` `register()` (throws in production, warns in dev) | 13.5 | AUTOMATED + wired at startup |
| Secrets never committed / logged | `.gitignore` covers `.env*` (except example); no secret patterns in `src`/`scripts`; log sanitizers in `worker-log.ts`, `nodemailer.ts`, `gemini.ts`, `db.ts` | 13.6 | AUTOMATED + CODE-REVIEW |
| CI enforces quality gate | `.github/workflows/ci.yml` (typecheck, lint, test, build + Postgres integration job). `postman:check` is a local-only gate (its validator lives in the untracked `scripts/` tree) and runs before opening a PR, not in CI. | 13.1 | CODE-REVIEW (runs on push/PR) |
| Responsive / no page-level horizontal overflow; wide tables scroll in isolated containers | `docs/frontend/RESPONSIVE_ACCESSIBILITY_SIGNOFF.md` — code-level review; overflow-x containers in all table managers | 13.7 | CODE-REVIEW (browser MANUAL-OPEN) |
| Keyboard nav, focus, aria-live, destructive confirmation, reduced-motion | Same doc — `focus-visible`, `aria-live`/`role`, inline delete confirmation, global reduced-motion media query | 13.7 | CODE-REVIEW (browser MANUAL-OPEN) |

## 2. Phase 12 builder confirmation

The AI Campaign Builder is implemented and its generation + draft-save behavior
is proven by existing unit tests (`tests/campaign-builder.test.mjs`,
`tests/campaign-builder-route.test.mjs`) and re-exercised end to end by
`scripts/run-e2e-smoke.mjs`, which drives the real
`generateCampaignPackage` → `buildTemplateDraftRequest`/`buildCampaignDraftRequest`
contract and persists real tenant Template + Campaign draft records.

## 3. Deferred capabilities (explicitly NOT in the MVP release claim)

| Capability | Reason | Action taken |
|---|---|---|
| **AI lead scoring** | No implementation exists. `lead_score` is only a contact attribute stored in `properties` and usable in segmentation filters; nothing computes it with AI. | Corrected homepage copy (`src/app/page.tsx`, `src/components/homepage/hero-stage.tsx`) from "AI lead scoring / each contact is analyzed to produce a validated lead score" to "Lead-score attributes / segmentation". README already lists it under "Still on the roadmap". |
| First-class unsubscribe / suppression list | Not implemented; only template copy can carry links. | Recorded as a launch **BLOCKER** for regulated/bulk sending (see §4). |
| Bounce processing | Out of Phase 13 scope. | DEFERRED. |
| Provider webhooks | Out of Phase 13 scope. | DEFERRED. |
| Deployment-level rate limiting (shared store) | No shared limiter selected. | Recorded as deployment requirement / BLOCKER (see §4 and Security Review). |
| Admin operations console | Out of scope. | DEFERRED. |

## 4. Unresolved launch limitations / blockers

- **Unsubscribe & suppression** — no first-class mechanism. BLOCKER for
  compliant bulk/marketing email; acceptable only for a controlled/opt-in
  recipient set. Decision required before public launch.
- **Deployment rate limiting** — auth/OTP/AI/cron endpoints have no shared-store
  rate limiter. Must be provided at the deployment edge (reverse proxy / WAF /
  platform) before public exposure. Do not rely on an in-memory limiter behind a
  horizontally-scaled deployment. BLOCKER for untrusted public traffic.
- **Live Gemini / live SMTP verification** — only the opt-in `smoke:live`
  command exercises real providers; not run in this evidence set. MANUAL-OPEN.
- **Browser responsive / accessibility execution** — sign-off is code-level;
  real device/browser and screen-reader runs are MANUAL-OPEN.
- **Dependency advisories** — 1 high (nodemailer `raw` bypass, not reachable in
  our send path) + 5 moderate (build/docs surface). Triaged, upgrades planned,
  not blocking. See Security Review.

## 5. Supported deployment assumptions

| Area | Assumption |
|---|---|
| Node runtime | Node 24 (pinned in `.nvmrc`; `engines` ≥ 22.6.0 for the type-stripping test runner) |
| PostgreSQL | v16 behavior; RLS with `FORCE ROW LEVEL SECURITY`; application connects as a **non-superuser, non-BYPASSRLS** role in production |
| HTTPS termination | Provided by the deployment edge (platform/reverse proxy); app assumes TLS upstream |
| Cron trigger | External scheduler calls `POST /api/worker/cron` with `Authorization: Bearer $CRON_SECRET` |
| SMTP provider | Any RFC 5321 SMTP server via Nodemailer (host/port/secure/user/pass/from) |
| Gemini provider | `gemini-2.5-flash`; primary + optional fallback keys; failures degrade to safe non-AI behavior |

## 6. Manual items intentionally left OPEN (not claimed complete)

- Live-provider smoke (`npm run smoke:live`).
- Cross-device/browser responsive verification and screen-reader pass.
- Production load / rate-limit soak.
- Legal/compliance sign-off for unsubscribe/suppression.
