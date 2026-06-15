import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const REQUIRED_ENV_VARS = [
  "DB_USER",
  "DB_HOST",
  "DB_NAME",
  "DB_PASSWORD",
] as const;
const INITIALIZATION_TIMEOUT_MS = 60_000;
const SLOW_QUERY_THRESHOLD_MS = 1_000;
const MIGRATION_VERSION = "v3_email_logs_rls_ms8";

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

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true }
      : false,
});

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

CREATE TABLE IF NOT EXISTS "Contacts" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  email VARCHAR UNIQUE NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Lists" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contact_list_relation" (
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
  run_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Email_logs" (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  campaign_id INT REFERENCES "Campaigns"(id) ON DELETE SET NULL,
  contact_id INT REFERENCES "Contacts"(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON "Workspaces"(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON "Workspace_members"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON "Workspace_members"(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON "Contacts"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lists_workspace_id ON "Lists"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_list_id ON "Contact_list_relation"(list_id);
CREATE INDEX IF NOT EXISTS idx_templates_workspace_id ON "Templates"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON "Campaigns"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id ON "Campaigns"(template_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_workspace_id ON "Email_logs"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_id ON "Email_logs"(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_contact_id ON "Email_logs"(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_properties_gin ON "Contacts" USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_campaigns_target_filters_gin ON "Campaigns" USING GIN (target_filters);

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

-- MS-7: Evolve Templates and Campaigns (idempotent for pre-existing databases)
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS name VARCHAR NOT NULL DEFAULT '';
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS body_html TEXT NOT NULL DEFAULT '';
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS body_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Templates" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Templates" ALTER COLUMN title DROP NOT NULL;
ALTER TABLE "Templates" ALTER COLUMN content DROP NOT NULL;

ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_campaigns_target_filters_gin ON "Campaigns" USING GIN (target_filters);

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

INSERT INTO "Schema_migrations" (version)
VALUES ('${MIGRATION_VERSION}')
ON CONFLICT (version) DO NOTHING;
`;

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let shutdownHandlerRegistered = false;

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

function registerShutdownHandler(): void {
  if (shutdownHandlerRegistered) {
    return;
  }

  shutdownHandlerRegistered = true;

  process.once("SIGTERM", () => {
    void pool.end().catch((error) => {
      console.error("Failed to close PostgreSQL pool during SIGTERM:", error);
    });
  });
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
      const client = await pool.connect();

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

export async function withWorkspace<T>(
  workspaceId: number,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  registerShutdownHandler();

  const client = await pool.connect();

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
      console.error("PostgreSQL rollback failed in workspace scope:", rollbackError);
    }

    throw error;
  } finally {
    client.release();
  }
}
