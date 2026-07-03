# Production Runbook & Release Sign-Off

Operational handoff for deploying and running Marekto. Covers configuration,
database lifecycle, cron, SMTP, Gemini, health, incident triage, and rollback.

## 1. Environment configuration

All variables and grouping are documented in `.env.example`. The server-only
preflight `src/lib/env-preflight.ts` validates production-critical values and
**fails closed**. It is wired into server startup via the Next.js
`instrumentation.ts` `register()` hook (Node.js runtime only, skipped during
`next build`): in production a configuration error throws and aborts startup; in
development it only warns. It never touches the database and never logs secret
values. You can also invoke `checkEnvironment`/`assertEnvironment` directly as a
deploy-time preflight.

Production hard requirements (preflight errors if violated):
- `JWT_SECRET` present, ≥ 32 chars, not a known-default value.
- `CRON_SECRET` present, ≥ 16 chars, not a known-default (worker fails closed
  without it).
- `DATABASE_URL` valid and includes a database name; TLS not disabled for a
  remote database.
- If any SMTP var is set, all five must be valid (host, port 1–65535, user,
  password, from, secure mode).
- `GEMINI_TIMEOUT_MS` (if set) within 1000–120000.

Warnings (non-blocking): missing `GEMINI_API_KEY` (AI degrades to safe non-AI
behavior), unconfigured SMTP (delivery disabled).

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 2. Deployment

1. Provision PostgreSQL 16 and a **non-superuser, non-BYPASSRLS** application
   role with `SELECT/INSERT/UPDATE/DELETE` on the app tables + sequence usage.
   RLS + `FORCE ROW LEVEL SECURITY` protect tenants; a superuser role would
   bypass RLS and must not be used at runtime.
2. Set environment variables (see §1). Confirm the preflight passes.
3. Apply the schema: `DATABASE_URL=... node scripts/apply-schema.mjs`
   (or let the app run `initializeDatabase()` on first boot).
4. Build and start: `npm ci && npm run build && npm start` behind HTTPS
   termination.
5. Configure the external cron trigger (§4).

## 3. Database initialization, migration, rollback, backup/restore

- **Initialization / migration**: schema lives in `initializeDatabase()`
  (`src/lib/db.ts`). Migrations are inline and **idempotent**
  (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `DO` blocks),
  recorded in `"Schema_migrations"` by `MIGRATION_VERSION`. Idempotency is proven
  by `tests/schema-idempotency.integration.test.mjs`. Re-running is safe and
  non-destructive.
- **Rollback**: the schema is forward-only and additive; there are no automatic
  down-migrations. To roll back a bad release, redeploy the previous application
  build. Because migrations are additive, an older build runs against the newer
  schema. Only a genuinely incompatible column change would require a restore
  from backup — treat such changes as expand/contract with a data backup first.
- **Backup**: `pg_dump` on a schedule (e.g. `pg_dump "$DATABASE_URL" -Fc -f backup.dump`).
  Take a fresh dump immediately before any migration that drops/renames.
- **Restore**: `pg_restore --clean --if-exists -d "$DATABASE_URL" backup.dump`
  against the target database. Verify with `npm run test:integration` pointed at
  a **restored copy**, never production.

## 4. Cron cadence & stale-claim lease

- Trigger `POST /api/worker/cron` (or `GET`) with
  `Authorization: Bearer $CRON_SECRET`. Recommended cadence: every 1–5 minutes.
- Each run claims one campaign at a time per workspace with `FOR UPDATE SKIP
  LOCKED`, so concurrent triggers cannot double-send (proven by
  `tests/worker-delivery.integration.test.mjs`).
- **Stale-claim lease** = `CLAIM_LEASE_MINUTES` (15). A campaign stuck in
  `processing` (e.g. a crashed run) becomes eligible again only after the lease
  expires. Keep the cron interval well under the lease so recovery is timely but
  a healthy run is never preempted.

## 5. SMTP

- Configure all five SMTP vars. Delivery uses Nodemailer's real SMTP transport
  with `disableFileAccess`/`disableUrlAccess` set on every send.
- If SMTP is unset/invalid, recipients are logged `failed` with a sanitized
  reason; the campaign is marked `failed`. No email is silently dropped.

## 6. Gemini behavior

- `gemini-2.5-flash`, primary key + optional comma/semicolon/newline-separated
  fallback keys (tried on 401/403/429). Timeout `GEMINI_TIMEOUT_MS` (default
  20000, bounded 1000–120000).
- On any provider failure or invalid output, AI segmentation/builder/
  personalization **fall back to safe, non-invented behavior**; personalization
  falls back to the raw template and records the fallback reason in `Email_logs`.

## 7. Health / readiness guidance

- Liveness: process up and serving.
- Readiness: `initializeDatabase()` succeeded and the pool can `SELECT 1`.
- Do **not** expose tenant data, row counts, secrets, or connection strings in
  any health endpoint. A boolean up/ready is sufficient.

## 8. Post-deploy smoke checks

1. Auth: register/login succeeds; a request with a spoofed `x-workspace-id` is
   scoped to the JWT workspace.
2. Database: readiness check green; `"Schema_migrations"` contains the current
   version.
3. Worker: a manual `POST /api/worker/cron` with the correct secret returns
   `success:true`; a wrong/absent secret is rejected (401/503).
4. SMTP: a controlled test campaign to an internal inbox delivers and logs
   `sent`.
5. Logs: worker logs are structured JSON with no secrets or raw stack traces.

## 9. Incident triage & rollback triggers

Roll back (redeploy previous build; if schema-incompatible, restore backup) when:

| Trigger | Signal | Action |
|---|---|---|
| Authentication failure | Valid users cannot log in / 401 storms | Roll back app; verify `JWT_SECRET` unchanged/valid |
| Tenant leakage | Any cross-workspace data visibility | **Immediate** rollback; run `npm run test:integration` on a restored copy; audit RLS policies |
| Duplicate sends | >1 delivery log per recipient per run | Stop cron; investigate claim path; roll back if regression |
| Migration failure | `initializeDatabase()`/`apply-schema` errors on deploy | Halt deploy; restore pre-migration backup; fix migration idempotency |
| Elevated SMTP failure | Sudden spike in `failed` `Email_logs` | Check SMTP creds/provider; pause scheduling; roll back if config regression |
| Corrupted/inconsistent delivery logs | Campaign status disagrees with `Email_logs` counts | Freeze worker; reconcile from `Email_logs`; roll back if code regression |

## 10. Known limitations & deferred work

See `docs/roadmap/PHASE_13_RELEASE_EVIDENCE_MATRIX.md` §3–§4: no first-class
unsubscribe/suppression, no bounce/webhook processing, no shared-store rate
limiter (must be provided at the deployment edge), AI lead scoring deferred, live
Gemini/SMTP verification and browser accessibility runs remain manual-open.
