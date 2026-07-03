# Integration & End-to-End Testing

This covers the PostgreSQL-backed integration suite (Phase 13.2/13.3) and the
controlled end-to-end MVP smoke path (Phase 13.4). These are **separate** from
the fast unit/contract suite (`npm test`) and require a real, disposable
PostgreSQL database.

## Safety guarantee

Every destructive helper refuses to run unless `DATABASE_URL` names a database
whose name contains `test` or `ci` (see `scripts/helpers/integration-safety.mjs`
and `tests/helpers/integration.mjs`). This makes it impossible for the harness to
`DROP SCHEMA`, truncate, or delete against a primary database. Cleanup only ever
removes the specific workspaces/roles the harness created.

## Prerequisites

- Node 24 (`.nvmrc`).
- A disposable PostgreSQL 16 database. The application must be able to create
  roles for the RLS test, so connect as a superuser to the **test** database
  only.

### Local PostgreSQL via Docker

```bash
docker run -d --name marekto-pg-test \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=marekto_test \
  -p 55432:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:postgres@localhost:55432/marekto_test"
export DATABASE_SSL=disable
```

## Commands

```bash
# PostgreSQL integration suite (idempotency + RLS + worker concurrency)
npm run test:integration

# Controlled end-to-end smoke (real SMTP transport to a local capture sink)
npm run smoke:e2e

# Opt-in LIVE smoke (real Gemini + real SMTP) — NEVER in ordinary CI
GEMINI_API_KEY=... SMTP_HOST=... SMTP_PORT=... SMTP_USER=... \
SMTP_PASSWORD=... SMTP_FROM=... npm run smoke:live
```

`npm run test:integration` sets `RUN_DB_INTEGRATION_TESTS=1`, runs files matching
`tests/*.integration.test.mjs` with `--test-concurrency=1` (they share one
database, so they must run one file at a time), and refuses to start without a
`DATABASE_URL`.

## What the integration suite proves

`tests/schema-idempotency.integration.test.mjs`
- Drops the public schema to a clean slate.
- Runs `scripts/apply-schema.mjs` twice in **separate processes** (so the
  in-module init guard does not mask a non-idempotent statement).
- Asserts every expected table exists, a sentinel row survives re-init
  (non-destructive), and `FORCE ROW LEVEL SECURITY` is on for all tenant tables.

`tests/tenant-isolation.integration.test.mjs`
- Creates two workspaces with the **same** contact email under a restricted,
  non-superuser, non-`BYPASSRLS` role.
- Asserts cross-tenant `SELECT`/`UPDATE`/`DELETE`/relation-create all fail, a
  spoofed `workspace_id` insert is rejected by the RLS `WITH CHECK`, and no
  tenant data is visible without a workspace context.

`tests/worker-delivery.integration.test.mjs`
- Two concurrent claims on one due campaign → exactly one owner.
- Draft and future-scheduled campaigns are never claimed.
- A fresh `processing` lease is not re-claimable; a stale one is reclaimed.
- One recipient yields exactly one delivery log per run.

## End-to-end smoke path (`npm run smoke:e2e`)

Runbook — exact stages executed by `scripts/run-e2e-smoke.mjs`:

1. **Setup** — assert a disposable test DB; set non-production JWT/CRON secrets.
2. **Provision tenant** — insert Workspace + User + membership (register-equivalent).
3. **Auth/proxy** — sign a real JWT, run it through the real `authenticateTenantRequest`
   with a **spoofed** `x-workspace-id`, assert the proxy overwrites it with the
   verified workspace.
4. **Contacts** — create 3 tenant contacts (2 match the audience filter, 1 does not).
5. **Builder** — generate a Campaign Builder package (controlled Gemini double,
   labelled controlled-provider; real Gemini with `--live`).
6. **Draft contract** — map through the real `buildTemplateDraftRequest` /
   `buildCampaignDraftRequest`; validate `targetFilters` with the canonical
   `parseCampaignTargetFilters`; persist real Template + Campaign **draft** records.
7. **Schedule** — set the campaign `pending` with a past `run_at` (immediately due).
8. **Worker** — exercise the real cron authorization gate, claim with the real
   `CLAIM_CAMPAIGN_SQL`, personalize (or safe fallback), and deliver over
   Nodemailer's **real SMTP transport** to the in-process capture sink
   (`scripts/lib/smtp-capture.mjs`).
9. **Verify** — using the exact SQL + transforms of the email-logs route
   (`SELECT_CAMPAIGN_DELIVERY_SQL`, `SELECT_EMAIL_LOG_SUMMARY_SQL`,
   `toCampaignDeliverySummary`): campaign `sent`, one log per matching recipient,
   all delivered, none failed, capture received each message, non-matching
   contact excluded.
10. **Cleanup** — delete only the created workspace (cascade).

### Recorded controlled run (sanitized)

```
stage-1: provisioned workspace <id>
stage-2: real proxy replaced spoofed x-workspace-id -> verified <id>
stage-3: created 3 contacts (2 matching filter, 1 non-matching)
stage-4: generated builder package "July Beginner English Signup Push" (controlled-provider)
stage-5: saved Template <id> + Campaign <id> as real draft records
stage-7: scheduled campaign <id> (pending, due <ts>)
stage-8: cron authorization gate accepts the secret and rejects a wrong one
stage-8: SMTP capture listening on 127.0.0.1:<port>
stage-8: delivered sent=2 failed=0 over SMTP capture
stage-9: verified status=sent, sent=2/2, failed=0
done: controlled end-to-end smoke path PASSED (7 assertions)
cleanup: deleted workspace <id> (cascade)
```

Provider honesty: the controlled run uses a deterministic Gemini double and a
local SMTP capture sink. The SMTP **transport and protocol are real**; only the
provider endpoints are test doubles. Do not describe a controlled run as
live-provider evidence.

## CI

`.github/workflows/ci.yml` runs the integration suite in a dedicated job with a
`postgres:16-alpine` service and throwaway, non-secret credentials. The live
smoke command is never run in CI.
