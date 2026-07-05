import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

import { hashPassword } from "./password.ts";

// Single source of truth for the database connection. We deliberately rely on
// DATABASE_URL only (not the individual DB_HOST/DB_PORT/... vars) so the app and
// any external tooling (DBeaver, migrations) cannot drift apart.
const REQUIRED_ENV_VARS = ["DATABASE_URL"] as const;
const INITIALIZATION_TIMEOUT_MS = 60_000;
const SLOW_QUERY_THRESHOLD_MS = 1_000;
const MIGRATION_VERSION = "v14_uuid_identifiers";
const DEFAULT_ADMIN_EMAIL = "Admin@marekto.com";
const DEFAULT_ADMIN_PASSWORD = "123456";
const DEFAULT_ADMIN_ROLE = "admin";
const DEFAULT_ADMIN_WORKSPACE_ROLE = "owner";
const DEFAULT_ADMIN_WORKSPACE_NAME = "Marekto Admin";

type SafeDatabaseConfig = {
  source: "DATABASE_URL";
  connectionString: string;
  ssl: string;
};

type IdRow = {
  id: string;
};

type WorkspaceIdRow = {
  workspace_id: string;
};

/**
 * Return the connection string with its password redacted, safe to emit to
 * logs when diagnosing connection failures or timeouts.
 */
function maskConnectionString(connectionString: string | undefined): string {
  if (!connectionString) {
    return "<unset>";
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "<unparseable connection string>";
  }
}

function parseDatabaseUrl(): URL | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    return new URL(process.env.DATABASE_URL);
  } catch {
    return null;
  }
}

function isLocalDatabaseHost(hostname: string | undefined): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname ?? "");
}

function getRequestedSslMode(): string | null {
  const explicitSsl = process.env.DATABASE_SSL?.trim().toLowerCase();

  if (explicitSsl) {
    return explicitSsl;
  }

  const pgSslMode = process.env.PGSSLMODE?.trim().toLowerCase();

  if (pgSslMode) {
    return pgSslMode;
  }

  return parseDatabaseUrl()?.searchParams.get("sslmode")?.toLowerCase() ?? null;
}

function resolveDatabaseSsl(): PoolConfig["ssl"] {
  const requestedSslMode = getRequestedSslMode();

  if (
    requestedSslMode &&
    ["0", "false", "off", "no", "disable", "disabled"].includes(
      requestedSslMode,
    )
  ) {
    return false;
  }

  if (
    requestedSslMode &&
    ["1", "true", "on", "yes", "require", "required"].includes(
      requestedSslMode,
    )
  ) {
    return { rejectUnauthorized: false };
  }

  if (requestedSslMode && ["verify-ca", "verify-full"].includes(requestedSslMode)) {
    return { rejectUnauthorized: true };
  }

  const databaseUrl = parseDatabaseUrl();

  if (
    process.env.NODE_ENV === "production" &&
    !isLocalDatabaseHost(databaseUrl?.hostname)
  ) {
    return { rejectUnauthorized: true };
  }

  return false;
}

function describeDatabaseSsl(ssl: PoolConfig["ssl"]): string {
  if (!ssl) {
    return "disabled";
  }

  if (ssl === true) {
    return "enabled";
  }

  return ssl.rejectUnauthorized === false
    ? "enabled (rejectUnauthorized=false)"
    : "enabled (rejectUnauthorized=true)";
}

/**
 * Snapshot of the connection parameters with the password redacted, safe to
 * emit to logs when diagnosing connection failures or timeouts.
 */
function describeDatabaseConfig(): SafeDatabaseConfig {
  const ssl = resolveDatabaseSsl();

  return {
    source: "DATABASE_URL",
    connectionString: maskConnectionString(process.env.DATABASE_URL),
    ssl: describeDatabaseSsl(ssl),
  };
}

function validateDatabaseEnv(): void {
  const missingEnvVars = REQUIRED_ENV_VARS.filter(
    (envName) => !process.env[envName],
  );

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required database environment variables: ${missingEnvVars.join(", ")}`,
    );
  }
}

validateDatabaseEnv();

/**
 * Build a fresh Pool. Called once per process in production, and once per
 * cold start in development — the singleton below ensures Next.js Fast Refresh
 * does NOT recreate it on every compilation pass, which would otherwise leak
 * pools/connections until `pool.connect()` times out. The error listener and
 * startup log live here so they attach exactly once per real pool, not on every
 * hot reload.
 */
function poolProvider(): Pool {
  const ssl = resolveDatabaseSsl();

  const newPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Limit max connections per pool instance safely.
    max: 10,
    // Force a fast failure instead of letting a write hang.
    connectionTimeoutMillis: 5000,
    // Reap idle connections promptly so a poisoned/stuck connection cannot linger.
    idleTimeoutMillis: 10000,
    ssl,
  });

  newPool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
  });

  // Verify at creation which connection source is actually in effect.
  console.log(
    `[db] PostgreSQL pool initialized via connectionString (DATABASE_URL=${
      process.env.DATABASE_URL ? "set" : "MISSING"
    }, ssl=${describeDatabaseSsl(ssl)}) -> ${maskConnectionString(
      process.env.DATABASE_URL,
    )}`,
  );

  return newPool;
}

// Preserve the pool reference across hot reloads via globalThis so dev Fast
// Refresh reuses one pool instead of accumulating new ones each compile.
declare global {
  var cachedPgPool: Pool | undefined;
}

export const pool: Pool = globalThis.cachedPgPool ?? poolProvider();

if (process.env.NODE_ENV !== "production") {
  globalThis.cachedPgPool = pool;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS "Schema_migrations" (
  version VARCHAR PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Users" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspaces" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  owner_id UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_members" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  role VARCHAR NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS "Registration_otps" (
  email VARCHAR PRIMARY KEY,
  password_hash VARCHAR NOT NULL,
  workspace_name VARCHAR NOT NULL,
  otp_hash VARCHAR NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contacts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  email VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS "Lists" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contact_list_relation" (
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES "Contacts"(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES "Lists"(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS "Templates" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  title VARCHAR,
  content TEXT,
  name VARCHAR NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Campaigns" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  template_id UUID REFERENCES "Templates"(id) ON DELETE SET NULL,
  name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft',
  target_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_personalization_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'pending', 'processing', 'sent', 'failed'))
);

CREATE TABLE IF NOT EXISTS "Email_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES "Campaigns"(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES "Contacts"(id) ON DELETE SET NULL,
  status VARCHAR NOT NULL DEFAULT 'sent',
  error_message TEXT,
  personalization_source VARCHAR(32),
  personalization_error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Ai_outputs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  feature VARCHAR NOT NULL,
  input_hash VARCHAR NOT NULL,
  input_text TEXT NOT NULL,
  output_json JSONB NOT NULL,
  provider VARCHAR NOT NULL,
  model VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'generated',
  created_by UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_outputs_status_check
    CHECK (status IN ('generated', 'approved', 'stale'))
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON "Workspaces"(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON "Workspace_members"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON "Workspace_members"(user_id);
CREATE INDEX IF NOT EXISTS idx_registration_otps_expires_at ON "Registration_otps"(expires_at);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON "Contacts"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_email_unique ON "Contacts"(workspace_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_id_id_unique ON "Contacts"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_lists_workspace_id ON "Lists"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_workspace_id_id_unique ON "Lists"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_list_id ON "Contact_list_relation"(list_id);
CREATE INDEX IF NOT EXISTS idx_templates_workspace_id ON "Templates"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON "Campaigns"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_due
  ON "Campaigns"(workspace_id, status, run_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id ON "Campaigns"(template_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_id ON "Email_logs"(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_contact_id ON "Email_logs"(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_properties_gin ON "Contacts" USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_campaigns_target_filters_gin ON "Campaigns" USING GIN (target_filters);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature
  ON "Ai_outputs"(workspace_id, feature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature_input_hash_unique
  ON "Ai_outputs"(workspace_id, feature, input_hash);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_output_json_gin
  ON "Ai_outputs" USING GIN (output_json);

ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS first_name VARCHAR;
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS last_name VARCHAR;
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS phone VARCHAR;

ALTER TABLE "Contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contacts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_workspace_isolation ON "Contacts";
CREATE POLICY contacts_workspace_isolation ON "Contacts"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

-- Phase repair: make contact identity tenant-local instead of globally unique.
ALTER TABLE "Contacts" DROP CONSTRAINT IF EXISTS "Contacts_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_email_unique
  ON "Contacts"(workspace_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_id_id_unique
  ON "Contacts"(workspace_id, id);

-- Phase repair: give list/contact relations a direct tenant owner. Existing
-- same-workspace relations are backfilled; a cross-workspace relation aborts
-- the migration so it can be investigated instead of being silently retained.
ALTER TABLE "Contact_list_relation" ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE "Contacts" DISABLE ROW LEVEL SECURITY;

UPDATE "Contact_list_relation" relation
SET workspace_id = contact.workspace_id
FROM "Contacts" contact, "Lists" list
WHERE relation.contact_id = contact.id
  AND relation.list_id = list.id
  AND contact.workspace_id = list.workspace_id
  AND relation.workspace_id IS NULL;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Contact_list_relation" WHERE workspace_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-workspace or orphaned contact-list relation detected';
  END IF;
END
$do$;

ALTER TABLE "Contact_list_relation" ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE "Contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contacts" FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_workspace_id_id_unique
  ON "Lists"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_workspace_id
  ON "Contact_list_relation"(workspace_id);

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_list_relation_workspace_fk'
  ) THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_workspace_fk
      FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_list_relation_contact_workspace_fk'
  ) THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_contact_workspace_fk
      FOREIGN KEY (workspace_id, contact_id)
      REFERENCES "Contacts"(workspace_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_list_relation_list_workspace_fk'
  ) THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_list_workspace_fk
      FOREIGN KEY (workspace_id, list_id)
      REFERENCES "Lists"(workspace_id, id) ON DELETE CASCADE;
  END IF;
END
$do$;

ALTER TABLE "Lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lists_workspace_isolation ON "Lists";
CREATE POLICY lists_workspace_isolation ON "Lists"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

ALTER TABLE "Contact_list_relation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_list_relation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_list_relation_workspace_isolation ON "Contact_list_relation";
CREATE POLICY contact_list_relation_workspace_isolation ON "Contact_list_relation"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

-- MS-7: Evolve Templates and Campaigns (idempotent for pre-existing databases)
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS name VARCHAR NOT NULL DEFAULT '';
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS body_html TEXT NOT NULL DEFAULT '';
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS body_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Templates" ALTER COLUMN title DROP NOT NULL;
ALTER TABLE "Templates" ALTER COLUMN content DROP NOT NULL;

ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS failure_reason TEXT;
-- Phase 10.1: campaign-level AI personalization toggle.
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS ai_personalization_enabled BOOLEAN NOT NULL DEFAULT false;
-- PQ-4: optional campaign-specific guidance for AI personalization.
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS ai_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Campaigns" DISABLE ROW LEVEL SECURITY;

UPDATE "Campaigns" SET status = 'pending' WHERE status = 'scheduled';
UPDATE "Campaigns" SET status = 'sent' WHERE status = 'completed';

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Campaigns"
    WHERE status NOT IN ('draft', 'pending', 'processing', 'sent', 'failed')
  ) THEN
    RAISE EXCEPTION 'Unsupported campaign status exists; repair it before migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_status_check'
  ) THEN
    ALTER TABLE "Campaigns"
      ADD CONSTRAINT campaigns_status_check
      CHECK (status IN ('draft', 'pending', 'processing', 'sent', 'failed'));
  END IF;
END
$do$;

ALTER TABLE "Campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaigns" FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_campaigns_target_filters_gin ON "Campaigns" USING GIN (target_filters);
CREATE INDEX IF NOT EXISTS idx_campaigns_due
  ON "Campaigns"(workspace_id, status, run_at);

ALTER TABLE "Templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_workspace_isolation ON "Templates";
CREATE POLICY templates_workspace_isolation ON "Templates"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

ALTER TABLE "Campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_workspace_isolation ON "Campaigns";
CREATE POLICY campaigns_workspace_isolation ON "Campaigns"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

-- MS-8: Evolve Email_logs for multi-tenant RLS (idempotent for pre-existing databases)
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Email_logs' AND column_name = 'err_message'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Email_logs' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE "Email_logs" RENAME COLUMN err_message TO error_message;
  END IF;
END
$do$;

ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES "Workspaces"(id) ON DELETE CASCADE;
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS error_message TEXT;
-- Phase 10.1: per-recipient AI personalization delivery observability.
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS personalization_source VARCHAR(32);
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS personalization_error TEXT;

-- Phase 11: delivery logs must survive contact deletion for observability.
-- Replace any cascading contact FK with ON DELETE SET NULL.
DO $do$
DECLARE
  contact_fk_name TEXT;
BEGIN
  SELECT con.conname INTO contact_fk_name
  FROM pg_constraint con
  WHERE con.conrelid = '"Email_logs"'::regclass
    AND con.contype = 'f'
    AND con.confrelid = '"Contacts"'::regclass
    AND con.confdeltype = 'c';

  IF contact_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Email_logs" DROP CONSTRAINT %I', contact_fk_name);
    ALTER TABLE "Email_logs"
      ADD CONSTRAINT email_logs_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES "Contacts"(id) ON DELETE SET NULL;
  END IF;
END
$do$;
ALTER TABLE "Email_logs" ALTER COLUMN status SET DEFAULT 'sent';
ALTER TABLE "Email_logs" ALTER COLUMN sent_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Email_logs" ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE "Email_logs" ALTER COLUMN contact_id DROP NOT NULL;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Email_logs" WHERE workspace_id IS NULL) THEN
    ALTER TABLE "Email_logs" ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_email_logs_workspace_id ON "Email_logs"(workspace_id);

ALTER TABLE "Email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Email_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_workspace_isolation ON "Email_logs";
CREATE POLICY email_logs_workspace_isolation ON "Email_logs"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

-- Phase 6.1: Tenant-scoped AI output cache for validated provider results.
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES "Workspaces"(id) ON DELETE CASCADE;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS feature VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS input_hash VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS input_text TEXT;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS output_json JSONB;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS provider VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS model VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'generated';
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES "Users"(id) ON DELETE SET NULL;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Ai_outputs"
    WHERE workspace_id IS NULL
      OR feature IS NULL
      OR input_hash IS NULL
      OR input_text IS NULL
      OR output_json IS NULL
      OR provider IS NULL
      OR model IS NULL
      OR status IS NULL
  ) THEN
    RAISE EXCEPTION 'Incomplete AI output cache row detected; repair it before migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_outputs_status_check'
  ) THEN
    ALTER TABLE "Ai_outputs"
      ADD CONSTRAINT ai_outputs_status_check
      CHECK (status IN ('generated', 'approved', 'stale'));
  END IF;
END
$do$;

ALTER TABLE "Ai_outputs" ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN feature SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN input_hash SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN input_text SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN output_json SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN provider SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN model SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN status SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE "Ai_outputs" ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature
  ON "Ai_outputs"(workspace_id, feature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature_input_hash_unique
  ON "Ai_outputs"(workspace_id, feature, input_hash);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_output_json_gin
  ON "Ai_outputs" USING GIN (output_json);

ALTER TABLE "Ai_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ai_outputs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_outputs_workspace_isolation ON "Ai_outputs";
CREATE POLICY ai_outputs_workspace_isolation ON "Ai_outputs"
  USING (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), '')
  );

-- Phase 14: Admin console audit trail. This is a cross-tenant SYSTEM table (like
-- "Users"/"Workspaces"): it is deliberately NOT row-level-security protected so
-- the non-superuser app role can read/write it outside any workspace context.
-- It stores only sanitized, bounded metadata — never secrets or raw headers.
CREATE TABLE IF NOT EXISTS "Admin_audit_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  action VARCHAR NOT NULL,
  target_type VARCHAR NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_user_id
  ON "Admin_audit_logs"(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON "Admin_audit_logs"(created_at DESC);

-- Phase 16: workspace collaboration, invite links, and owner-visible audit.
ALTER TABLE "Registration_otps" ALTER COLUMN workspace_name DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "Workspace_invites" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  token_hash VARCHAR UNIQUE NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id
  ON "Workspace_invites"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_token_hash
  ON "Workspace_invites"(token_hash);

CREATE TABLE IF NOT EXISTS "Workspace_audit_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  target_type VARCHAR NOT NULL,
  target_id UUID,
  action VARCHAR NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_workspace_id_created_at
  ON "Workspace_audit_logs"(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_actor_user_id
  ON "Workspace_audit_logs"(actor_user_id);

-- Phase 16 prep: separate system account roles from per-workspace roles.
-- "Users".role is only for platform access; workspace ownership lives in
-- "Workspace_members".role.
INSERT INTO "Workspace_members" (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'owner'
FROM "Workspaces" w
WHERE w.owner_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

UPDATE "Workspace_members" m
SET role = 'owner'
FROM "Workspaces" w
WHERE w.id = m.workspace_id
  AND w.owner_id = m.user_id
  AND m.role <> 'owner';

UPDATE "Workspace_members"
SET role = 'member'
WHERE role NOT IN ('owner', 'member');

UPDATE "Users"
SET role = 'user'
WHERE role NOT IN ('admin', 'user');

-- Technical migration: replace every internal integer entity identifier with
-- UUID while preserving existing rows and their relationships.
DO $do$
DECLARE
  users_id_type TEXT;
BEGIN
  SELECT data_type INTO users_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Users' AND column_name = 'id';

  IF users_id_type IN ('integer', 'bigint', 'smallint') THEN
    ALTER TABLE "Contacts" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Lists" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Contact_list_relation" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Templates" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Campaigns" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Email_logs" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "Ai_outputs" DISABLE ROW LEVEL SECURITY;

    ALTER TABLE "Users" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Workspaces" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Workspace_members" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Contacts" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Lists" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Templates" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Campaigns" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Email_logs" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Ai_outputs" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Admin_audit_logs" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Workspace_invites" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE "Workspace_audit_logs" ADD COLUMN id_uuid UUID NOT NULL DEFAULT gen_random_uuid();

    ALTER TABLE "Workspaces" ADD COLUMN owner_id_uuid UUID;
    ALTER TABLE "Workspace_members" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Workspace_members" ADD COLUMN user_id_uuid UUID;
    ALTER TABLE "Contacts" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Lists" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Contact_list_relation" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Contact_list_relation" ADD COLUMN contact_id_uuid UUID;
    ALTER TABLE "Contact_list_relation" ADD COLUMN list_id_uuid UUID;
    ALTER TABLE "Templates" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Campaigns" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Campaigns" ADD COLUMN template_id_uuid UUID;
    ALTER TABLE "Email_logs" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Email_logs" ADD COLUMN campaign_id_uuid UUID;
    ALTER TABLE "Email_logs" ADD COLUMN contact_id_uuid UUID;
    ALTER TABLE "Ai_outputs" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Ai_outputs" ADD COLUMN created_by_uuid UUID;
    ALTER TABLE "Admin_audit_logs" ADD COLUMN admin_user_id_uuid UUID;
    ALTER TABLE "Admin_audit_logs" ADD COLUMN target_id_uuid UUID;
    ALTER TABLE "Workspace_invites" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Workspace_invites" ADD COLUMN created_by_user_id_uuid UUID;
    ALTER TABLE "Workspace_audit_logs" ADD COLUMN workspace_id_uuid UUID;
    ALTER TABLE "Workspace_audit_logs" ADD COLUMN actor_user_id_uuid UUID;
    ALTER TABLE "Workspace_audit_logs" ADD COLUMN target_id_uuid UUID;

    UPDATE "Workspaces" w SET owner_id_uuid = u.id_uuid
    FROM "Users" u WHERE u.id = w.owner_id;
    UPDATE "Workspace_members" m SET workspace_id_uuid = w.id_uuid, user_id_uuid = u.id_uuid
    FROM "Workspaces" w, "Users" u WHERE w.id = m.workspace_id AND u.id = m.user_id;
    UPDATE "Contacts" c SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = c.workspace_id;
    UPDATE "Lists" l SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = l.workspace_id;
    UPDATE "Contact_list_relation" r
    SET workspace_id_uuid = w.id_uuid, contact_id_uuid = c.id_uuid, list_id_uuid = l.id_uuid
    FROM "Workspaces" w, "Contacts" c, "Lists" l
    WHERE w.id = r.workspace_id AND c.id = r.contact_id AND l.id = r.list_id;
    UPDATE "Templates" t SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = t.workspace_id;
    UPDATE "Campaigns" c SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = c.workspace_id;
    UPDATE "Campaigns" c SET template_id_uuid = t.id_uuid
    FROM "Templates" t WHERE t.id = c.template_id;
    UPDATE "Email_logs" e SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = e.workspace_id;
    UPDATE "Email_logs" e SET campaign_id_uuid = c.id_uuid
    FROM "Campaigns" c WHERE c.id = e.campaign_id;
    UPDATE "Email_logs" e SET contact_id_uuid = c.id_uuid
    FROM "Contacts" c WHERE c.id = e.contact_id;
    UPDATE "Ai_outputs" a SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = a.workspace_id;
    UPDATE "Ai_outputs" a SET created_by_uuid = u.id_uuid
    FROM "Users" u WHERE u.id = a.created_by;
    UPDATE "Admin_audit_logs" a SET admin_user_id_uuid = u.id_uuid
    FROM "Users" u WHERE u.id = a.admin_user_id;
    UPDATE "Admin_audit_logs" a SET target_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE a.target_type = 'workspace' AND w.id = a.target_id;
    UPDATE "Workspace_invites" i SET workspace_id_uuid = w.id_uuid, created_by_user_id_uuid = u.id_uuid
    FROM "Workspaces" w, "Users" u
    WHERE w.id = i.workspace_id AND u.id = i.created_by_user_id;
    UPDATE "Workspace_audit_logs" a SET workspace_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE w.id = a.workspace_id;
    UPDATE "Workspace_audit_logs" a SET actor_user_id_uuid = u.id_uuid
    FROM "Users" u WHERE u.id = a.actor_user_id;
    UPDATE "Workspace_audit_logs" a SET target_id_uuid = w.id_uuid
    FROM "Workspaces" w WHERE a.target_type = 'workspace' AND w.id = a.target_id;
    UPDATE "Workspace_audit_logs" a SET target_id_uuid = u.id_uuid
    FROM "Users" u WHERE a.target_type = 'member' AND u.id = a.target_id;
    UPDATE "Workspace_audit_logs" a SET target_id_uuid = i.id_uuid
    FROM "Workspace_invites" i WHERE a.target_type = 'invite' AND i.id = a.target_id;

    ALTER TABLE "Users" DROP COLUMN id CASCADE;
    ALTER TABLE "Workspaces" DROP COLUMN id CASCADE, DROP COLUMN owner_id CASCADE;
    ALTER TABLE "Workspace_members" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN user_id CASCADE;
    ALTER TABLE "Contacts" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE;
    ALTER TABLE "Lists" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE;
    ALTER TABLE "Contact_list_relation" DROP COLUMN workspace_id CASCADE, DROP COLUMN contact_id CASCADE, DROP COLUMN list_id CASCADE;
    ALTER TABLE "Templates" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE;
    ALTER TABLE "Campaigns" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN template_id CASCADE;
    ALTER TABLE "Email_logs" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN campaign_id CASCADE, DROP COLUMN contact_id CASCADE;
    ALTER TABLE "Ai_outputs" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN created_by CASCADE;
    ALTER TABLE "Admin_audit_logs" DROP COLUMN id CASCADE, DROP COLUMN admin_user_id CASCADE, DROP COLUMN target_id CASCADE;
    ALTER TABLE "Workspace_invites" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN created_by_user_id CASCADE;
    ALTER TABLE "Workspace_audit_logs" DROP COLUMN id CASCADE, DROP COLUMN workspace_id CASCADE, DROP COLUMN actor_user_id CASCADE, DROP COLUMN target_id CASCADE;

    ALTER TABLE "Users" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Workspaces" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Workspaces" RENAME COLUMN owner_id_uuid TO owner_id;
    ALTER TABLE "Workspace_members" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Workspace_members" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Workspace_members" RENAME COLUMN user_id_uuid TO user_id;
    ALTER TABLE "Contacts" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Contacts" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Lists" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Lists" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Contact_list_relation" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Contact_list_relation" RENAME COLUMN contact_id_uuid TO contact_id;
    ALTER TABLE "Contact_list_relation" RENAME COLUMN list_id_uuid TO list_id;
    ALTER TABLE "Templates" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Templates" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Campaigns" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Campaigns" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Campaigns" RENAME COLUMN template_id_uuid TO template_id;
    ALTER TABLE "Email_logs" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Email_logs" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Email_logs" RENAME COLUMN campaign_id_uuid TO campaign_id;
    ALTER TABLE "Email_logs" RENAME COLUMN contact_id_uuid TO contact_id;
    ALTER TABLE "Ai_outputs" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Ai_outputs" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Ai_outputs" RENAME COLUMN created_by_uuid TO created_by;
    ALTER TABLE "Admin_audit_logs" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Admin_audit_logs" RENAME COLUMN admin_user_id_uuid TO admin_user_id;
    ALTER TABLE "Admin_audit_logs" RENAME COLUMN target_id_uuid TO target_id;
    ALTER TABLE "Workspace_invites" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Workspace_invites" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Workspace_invites" RENAME COLUMN created_by_user_id_uuid TO created_by_user_id;
    ALTER TABLE "Workspace_audit_logs" RENAME COLUMN id_uuid TO id;
    ALTER TABLE "Workspace_audit_logs" RENAME COLUMN workspace_id_uuid TO workspace_id;
    ALTER TABLE "Workspace_audit_logs" RENAME COLUMN actor_user_id_uuid TO actor_user_id;
    ALTER TABLE "Workspace_audit_logs" RENAME COLUMN target_id_uuid TO target_id;

    ALTER TABLE "Users" ADD PRIMARY KEY (id);
    ALTER TABLE "Workspaces" ADD PRIMARY KEY (id);
    ALTER TABLE "Workspace_members" ADD PRIMARY KEY (id), ADD UNIQUE (workspace_id, user_id);
    ALTER TABLE "Contacts" ADD PRIMARY KEY (id), ADD CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email);
    ALTER TABLE "Lists" ADD PRIMARY KEY (id);
    ALTER TABLE "Contact_list_relation" ADD PRIMARY KEY (contact_id, list_id);
    ALTER TABLE "Templates" ADD PRIMARY KEY (id);
    ALTER TABLE "Campaigns" ADD PRIMARY KEY (id);
    ALTER TABLE "Email_logs" ADD PRIMARY KEY (id);
    ALTER TABLE "Ai_outputs" ADD PRIMARY KEY (id);
    ALTER TABLE "Admin_audit_logs" ADD PRIMARY KEY (id);
    ALTER TABLE "Workspace_invites" ADD PRIMARY KEY (id);
    ALTER TABLE "Workspace_audit_logs" ADD PRIMARY KEY (id);

    ALTER TABLE "Workspaces" ADD FOREIGN KEY (owner_id) REFERENCES "Users"(id) ON DELETE SET NULL;
    ALTER TABLE "Workspace_members" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (user_id) REFERENCES "Users"(id) ON DELETE CASCADE;
    ALTER TABLE "Contacts" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE;
    ALTER TABLE "Lists" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE;
    ALTER TABLE "Contact_list_relation" ADD CONSTRAINT contact_list_relation_workspace_fk FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (contact_id) REFERENCES "Contacts"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (list_id) REFERENCES "Lists"(id) ON DELETE CASCADE;
    ALTER TABLE "Templates" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE;
    ALTER TABLE "Campaigns" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (template_id) REFERENCES "Templates"(id) ON DELETE SET NULL;
    ALTER TABLE "Email_logs" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (campaign_id) REFERENCES "Campaigns"(id) ON DELETE SET NULL,
      ADD CONSTRAINT email_logs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES "Contacts"(id) ON DELETE SET NULL;
    ALTER TABLE "Ai_outputs" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (created_by) REFERENCES "Users"(id) ON DELETE SET NULL;
    ALTER TABLE "Admin_audit_logs" ADD FOREIGN KEY (admin_user_id) REFERENCES "Users"(id) ON DELETE CASCADE;
    ALTER TABLE "Workspace_invites" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (created_by_user_id) REFERENCES "Users"(id) ON DELETE CASCADE;
    ALTER TABLE "Workspace_audit_logs" ADD FOREIGN KEY (workspace_id) REFERENCES "Workspaces"(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (actor_user_id) REFERENCES "Users"(id) ON DELETE SET NULL;

    ALTER TABLE "Workspace_members" ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE "Contacts" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Lists" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Contact_list_relation" ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN contact_id SET NOT NULL, ALTER COLUMN list_id SET NOT NULL;
    ALTER TABLE "Templates" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Campaigns" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Email_logs" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Ai_outputs" ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE "Admin_audit_logs" ALTER COLUMN admin_user_id SET NOT NULL;
    ALTER TABLE "Workspace_invites" ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN created_by_user_id SET NOT NULL;
    ALTER TABLE "Workspace_audit_logs" ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON "Workspaces"(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON "Workspace_members"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON "Workspace_members"(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON "Contacts"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_email_unique ON "Contacts"(workspace_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_id_id_unique ON "Contacts"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_lists_workspace_id ON "Lists"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_workspace_id_id_unique ON "Lists"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_list_id ON "Contact_list_relation"(list_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_workspace_id ON "Contact_list_relation"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_templates_workspace_id ON "Templates"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON "Campaigns"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_due ON "Campaigns"(workspace_id, status, run_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id ON "Campaigns"(template_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_workspace_id ON "Email_logs"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_id ON "Email_logs"(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_contact_id ON "Email_logs"(contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature ON "Ai_outputs"(workspace_id, feature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature_input_hash_unique ON "Ai_outputs"(workspace_id, feature, input_hash);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_user_id ON "Admin_audit_logs"(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON "Workspace_invites"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_workspace_id_created_at ON "Workspace_audit_logs"(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_actor_user_id ON "Workspace_audit_logs"(actor_user_id);

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_list_relation_contact_workspace_fk') THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_contact_workspace_fk
      FOREIGN KEY (workspace_id, contact_id)
      REFERENCES "Contacts"(workspace_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_list_relation_list_workspace_fk') THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_list_workspace_fk
      FOREIGN KEY (workspace_id, list_id)
      REFERENCES "Lists"(workspace_id, id) ON DELETE CASCADE;
  END IF;
END
$do$;

ALTER TABLE "Contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_workspace_isolation ON "Contacts";
CREATE POLICY contacts_workspace_isolation ON "Contacts"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lists_workspace_isolation ON "Lists";
CREATE POLICY lists_workspace_isolation ON "Lists"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Contact_list_relation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_list_relation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_list_relation_workspace_isolation ON "Contact_list_relation";
CREATE POLICY contact_list_relation_workspace_isolation ON "Contact_list_relation"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_workspace_isolation ON "Templates";
CREATE POLICY templates_workspace_isolation ON "Templates"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_workspace_isolation ON "Campaigns";
CREATE POLICY campaigns_workspace_isolation ON "Campaigns"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Email_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_workspace_isolation ON "Email_logs";
CREATE POLICY email_logs_workspace_isolation ON "Email_logs"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));
ALTER TABLE "Ai_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ai_outputs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_outputs_workspace_isolation ON "Ai_outputs";
CREATE POLICY ai_outputs_workspace_isolation ON "Ai_outputs"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_allowed'
      AND conrelid = '"Users"'::regclass
  ) THEN
    ALTER TABLE "Users"
      ADD CONSTRAINT users_role_allowed CHECK (role IN ('admin', 'user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_members_role_allowed'
      AND conrelid = '"Workspace_members"'::regclass
  ) THEN
    ALTER TABLE "Workspace_members"
      ADD CONSTRAINT workspace_members_role_allowed
      CHECK (role IN ('owner', 'member'));
  END IF;
END
$do$;

INSERT INTO "Schema_migrations" (version)
VALUES ('${MIGRATION_VERSION}')
ON CONFLICT (version) DO NOTHING;
`;

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let shutdownHandlerRegistered = false;

function registerShutdownHandler(): void {
  if (shutdownHandlerRegistered) {
    return;
  }

  shutdownHandlerRegistered = true;

  // Guard against the Edge Runtime (and any context without Node's process
  // signal APIs), where `process.once` is unavailable and would crash Edge
  // instrumentation compilation.
  if (
    typeof process !== "undefined" &&
    typeof process.once === "function" &&
    process.env.NEXT_RUNTIME !== "edge"
  ) {
    process.once("SIGTERM", () => {
      void pool.end().catch((error) => {
        console.error("Failed to close PostgreSQL pool during SIGTERM:", error);
      });
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`Database operation timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function assertSafeQueryText(text: string): void {
  const dangerousPatterns = ["${", "`"];

  if (dangerousPatterns.some((pattern) => text.includes(pattern))) {
    throw new Error(
      "Unsafe query text detected. Use static SQL strings with parameter placeholders instead of string interpolation.",
    );
  }
}

async function executeQuery<T extends QueryResultRow = QueryResultRow>(
  executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  assertSafeQueryText(text);

  const startedAt = Date.now();

  try {
    const result = await executor.query<T>(text, params as unknown[] | undefined);
    const durationMs = Date.now() - startedAt;

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`Slow SQL query (${durationMs}ms): ${text.slice(0, 160)}`);
    }

    return result;
  } catch (error) {
    console.error("PostgreSQL query failed:", {
      text: text.slice(0, 160),
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

async function seedDefaultAdmin(client: PoolClient): Promise<void> {
  const existingAdmin = await executeQuery<IdRow>(
    client,
    'SELECT id FROM "Users" WHERE role = $1 LIMIT 1',
    [DEFAULT_ADMIN_ROLE],
  );

  if (existingAdmin.rows[0]) {
    return;
  }

  const existingDefaultUser = await executeQuery<IdRow>(
    client,
    'SELECT id FROM "Users" WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [DEFAULT_ADMIN_EMAIL],
  );
  const passwordHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
  let adminUserId = existingDefaultUser.rows[0]?.id ?? null;

  if (adminUserId) {
    await executeQuery(
      client,
      'UPDATE "Users" SET email = $1, password_hash = $2, role = $3 WHERE id = $4',
      [DEFAULT_ADMIN_EMAIL, passwordHash, DEFAULT_ADMIN_ROLE, adminUserId],
    );
  } else {
    const userResult = await executeQuery<IdRow>(
      client,
      'INSERT INTO "Users" (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [DEFAULT_ADMIN_EMAIL, passwordHash, DEFAULT_ADMIN_ROLE],
    );
    adminUserId = userResult.rows[0].id;
  }

  const membershipResult = await executeQuery<WorkspaceIdRow>(
    client,
    'SELECT workspace_id FROM "Workspace_members" WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1',
    [adminUserId],
  );
  let workspaceId = membershipResult.rows[0]?.workspace_id ?? null;

  if (!workspaceId) {
    const ownedWorkspaceResult = await executeQuery<IdRow>(
      client,
      'SELECT id FROM "Workspaces" WHERE owner_id = $1 ORDER BY id ASC LIMIT 1',
      [adminUserId],
    );
    workspaceId = ownedWorkspaceResult.rows[0]?.id ?? null;
  }

  if (!workspaceId) {
    const workspaceResult = await executeQuery<IdRow>(
      client,
      'INSERT INTO "Workspaces" (name, owner_id) VALUES ($1, $2) RETURNING id',
      [DEFAULT_ADMIN_WORKSPACE_NAME, adminUserId],
    );
    workspaceId = workspaceResult.rows[0].id;
  } else {
    await executeQuery(
      client,
      'UPDATE "Workspaces" SET owner_id = COALESCE(owner_id, $1) WHERE id = $2',
      [adminUserId, workspaceId],
    );
  }

  await executeQuery(
    client,
    'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role',
    [workspaceId, adminUserId, DEFAULT_ADMIN_WORKSPACE_ROLE],
  );
}

export async function initializeDatabase(): Promise<void> {
  registerShutdownHandler();

  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = withTimeout(
    (async () => {
      let client: PoolClient;

      try {
        client = await pool.connect();
      } catch (connectError) {
        console.error(
          "Failed to establish a PostgreSQL connection. Connection parameters (password masked):",
          describeDatabaseConfig(),
          connectError,
        );

        initializationPromise = null;
        throw connectError;
      }

      try {
        await executeQuery(client, "SELECT 1");
        await executeQuery(client, "BEGIN");
        await executeQuery(client, schemaSql);
        await seedDefaultAdmin(client);
        await executeQuery(client, "COMMIT");
        isInitialized = true;
      } catch (error) {
        try {
          await executeQuery(client, "ROLLBACK");
        } catch (rollbackError) {
          console.error("PostgreSQL rollback failed:", rollbackError);
        }

        initializationPromise = null;
        throw error;
      } finally {
        client.release();
      }
    })(),
    INITIALIZATION_TIMEOUT_MS,
  );

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;
    throw error;
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  registerShutdownHandler();
  return executeQuery<T>(pool, text, params);
}

/**
 * Acquire a raw pooled client for callers that need explicit, hands-on control
 * over a multi-statement transaction (BEGIN / COMMIT / ROLLBACK). The Pool
 * itself stays encapsulated in this module.
 *
 * CONTRACT: the caller MUST release the client in a `finally` block — use
 * `client.release()` to return it to the pool, or `client.release(true)` to
 * destroy a connection left in an unknown/broken state (e.g. a failed
 * ROLLBACK). Failing to release leaks the connection and eventually exhausts
 * the pool, surfacing as "Connection terminated due to connection timeout".
 * Prefer {@link withWorkspace} or {@link withTransaction} when you do not need
 * manual control, since they release automatically.
 */
export async function getDbClient(): Promise<PoolClient> {
  registerShutdownHandler();
  return pool.connect();
}

export async function withWorkspace<T>(
  workspaceId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  registerShutdownHandler();

  const client = await pool.connect();
  let connectionIsBroken = false;

  try {
    await executeQuery(client, "BEGIN");
    await executeQuery(client, "SELECT set_config('app.current_workspace_id', $1, true)", [
      String(workspaceId),
    ]);

    const result = await callback(client);

    await executeQuery(client, "COMMIT");
    return result;
  } catch (error) {
    try {
      await executeQuery(client, "ROLLBACK");
    } catch (rollbackError) {
      connectionIsBroken = true;
      console.error("PostgreSQL rollback failed in workspace scope:", rollbackError);
    }

    throw error;
  } finally {
    client.release(connectionIsBroken);
  }
}

/**
 * Run a callback inside a single pooled-client transaction WITHOUT any workspace
 * context. Use this for system-level, cross-tenant writes that span multiple
 * tables atomically (e.g. registration, which provisions a "Workspaces" row, a
 * "Users" row, and their "Workspace_members" binding before any tenant context
 * exists). The transaction COMMITs when the callback resolves and ROLLBACKs if
 * it throws. Tables touched here must not be RLS-protected, since no
 * `app.current_workspace_id` is set.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  registerShutdownHandler();

  const client = await pool.connect();
  let connectionIsBroken = false;

  try {
    await executeQuery(client, "BEGIN");

    const result = await callback(client);

    await executeQuery(client, "COMMIT");
    return result;
  } catch (error) {
    try {
      await executeQuery(client, "ROLLBACK");
    } catch (rollbackError) {
      connectionIsBroken = true;
      console.error("PostgreSQL rollback failed in transaction scope:", rollbackError);
    }

    throw error;
  } finally {
    client.release(connectionIsBroken);
  }
}
