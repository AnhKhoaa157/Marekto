# Marekto — Agent Rules

Marekto is a **multi-tenant marketing automation platform**. Workspaces are the tenant boundary, isolated natively in PostgreSQL via Row-Level Security (RLS).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · PostgreSQL via `pg` Pool (raw parameterized SQL — no ORM) · Nodemailer · node-cron.

---

## 🚨 Framework: Next.js App Router

- This project uses the **App Router** (`src/app/...`), not the Pages Router. Do not use `getServerSideProps`, `getStaticProps`, `pages/api`, or other Pages Router patterns.
- Route Handlers live in `route.ts` files and MUST declare execution constraints at the top:
  ```typescript
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  ```
- Dynamic route params are **async** — type them as `Promise` and `await` them:
  ```typescript
  type RouteParams = { params: Promise<{ id: string }> };
  ```
- Import alias `@/` maps to `src/`.

---

## 🔒 Multi-Tenancy & Database Rules

- **IDs are integers** (`SERIAL` / `INT`). Table names are **PascalCase and double-quoted** in SQL (e.g. `"Campaigns"`, `"Email_logs"`).
- **Tenant context:** read `workspaceId` from the `x-workspace-id` HTTP header; default to `1` when missing. Validate it is a positive integer before use.
- **Workspace wrapper is mandatory:** every tenant-scoped query runs inside `withWorkspace(workspaceId, async (client) => { ... })` from `@/lib/db`. This opens a transaction and sets `app.current_workspace_id` so RLS applies. Use the wrapper's `client` for all queries inside the callback.
- **Cross-tenant / system queries** (e.g. the cron worker discovering active workspaces) use the pool-level `query()` helper, which runs outside any workspace context. This only sees across tenants when the DB role bypasses RLS (superuser / `BYPASSRLS`).
- **RLS policies** follow the integer pattern, applied with `ENABLE` + `FORCE ROW LEVEL SECURITY`:
  ```sql
  workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  ```
- **No raw string concatenation of values into SQL.** Use parameterized placeholders (`$1`, `$2`, …). `executeQuery` rejects any SQL text containing `${` or backticks, so never build statements with template-literal interpolation. Build dynamic clauses by appending `$n` placeholders and pushing values onto a params array (whitelist any interpolated identifiers/column names).
- **JSONB columns:** stringify objects on write with `JSON.stringify(value ?? {})` and cast the placeholder (`$n::jsonb`). Read JSONB keys with parameterized `properties->>$n`.
- **Schema lives in `initializeDatabase()`** in [src/lib/db.ts](src/lib/db.ts). Migrations are inline, **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `DO $$ ... $$` blocks), and recorded by bumping `MIGRATION_VERSION` plus an insert into `"Schema_migrations"`. Update both the canonical `CREATE TABLE` and an idempotent `ALTER` block when evolving an existing table.

---

## 💻 Code Style & API Standards

- **Strict TypeScript:** no implicit `any`, no unused imports or variables. Define explicit row/body types for query results and request payloads.
- **Validation & parsing:** parse and validate request bodies with dedicated helper functions that throw descriptive `Error`s; map known validation messages to `400`, not-found to `404`, everything else to `500`.
- **Consistent JSON response shape:**
  - Success: `NextResponse.json({ success: true, data: ... }, { status: 200 | 201 })`
  - Error: `NextResponse.json({ success: false, error: message }, { status: 400 | 404 | 500 })`
- **Error handling:** wrap handler bodies in `try/catch`, `console.error` the failure, and derive `message` from `error instanceof Error ? error.message : "<fallback>"`.

---

## 🚀 Workflow Commands

| Task        | Command              |
| ----------- | -------------------- |
| Dev server  | `npm run dev`        |
| Build       | `npm run build`      |
| Lint        | `npm run lint`       |
| Type check  | `npx tsc --noEmit`   |

Code MUST pass `npx tsc --noEmit` and `npm run lint` cleanly before completion.

**Git commit pattern:** `feat(backend): hoàn thành MS-[X] module...`
