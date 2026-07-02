import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

// Single source of truth for the database connection. We deliberately rely on
// DATABASE_URL only (not the individual DB_HOST/DB_PORT/... vars) so the app and
// any external tooling (DBeaver, migrations) cannot drift apart.
const REQUIRED_ENV_VARS = ["DATABASE_URL"] as const;
const INITIALIZATION_TIMEOUT_MS = 60_000;
const SLOW_QUERY_THRESHOLD_MS = 1_000;
const MIGRATION_VERSION = "v8_ai_personalization_controls";

type SafeDatabaseConfig = {
  source: "DATABASE_URL";
  connectionString: string;
  ssl: string;
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
  id SERIAL PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspaces" (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  owner_id INT REFERENCES "Users"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_members" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
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
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  email VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS "Lists" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contact_list_relation" (
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  contact_id INT NOT NULL REFERENCES "Contacts"(id) ON DELETE CASCADE,
  list_id INT NOT NULL REFERENCES "Lists"(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS "Templates" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  title VARCHAR,
  content TEXT,
  name VARCHAR NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Campaigns" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  template_id INT REFERENCES "Templates"(id) ON DELETE SET NULL,
  name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft',
  target_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_personalization_enabled BOOLEAN NOT NULL DEFAULT false,
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
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  campaign_id INT REFERENCES "Campaigns"(id) ON DELETE SET NULL,
  contact_id INT REFERENCES "Contacts"(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'sent',
  error_message TEXT,
  personalization_source VARCHAR(32),
  personalization_error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Ai_outputs" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  feature VARCHAR NOT NULL,
  input_hash VARCHAR NOT NULL,
  input_text TEXT NOT NULL,
  output_json JSONB NOT NULL,
  provider VARCHAR NOT NULL,
  model VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'generated',
  created_by INT REFERENCES "Users"(id) ON DELETE SET NULL,
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
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
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
ALTER TABLE "Contact_list_relation" ADD COLUMN IF NOT EXISTS workspace_id INT;
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
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  );

ALTER TABLE "Contact_list_relation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_list_relation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_list_relation_workspace_isolation ON "Contact_list_relation";
CREATE POLICY contact_list_relation_workspace_isolation ON "Contact_list_relation"
  USING (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
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
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  );

ALTER TABLE "Campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_workspace_isolation ON "Campaigns";
CREATE POLICY campaigns_workspace_isolation ON "Campaigns"
  USING (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
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

ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS workspace_id INT REFERENCES "Workspaces"(id) ON DELETE CASCADE;
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS error_message TEXT;
-- Phase 10.1: per-recipient AI personalization delivery observability.
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS personalization_source VARCHAR(32);
ALTER TABLE "Email_logs" ADD COLUMN IF NOT EXISTS personalization_error TEXT;
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
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  );

-- Phase 6.1: Tenant-scoped AI output cache for validated provider results.
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS workspace_id INT REFERENCES "Workspaces"(id) ON DELETE CASCADE;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS feature VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS input_hash VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS input_text TEXT;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS output_json JSONB;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS provider VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS model VARCHAR;
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'generated';
ALTER TABLE "Ai_outputs" ADD COLUMN IF NOT EXISTS created_by INT REFERENCES "Users"(id) ON DELETE SET NULL;
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
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  )
  WITH CHECK (
    workspace_id = COALESCE(NULLIF(current_setting('app.current_workspace_id', true), ''), '0')::INT
  );

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
  workspaceId: number,
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
