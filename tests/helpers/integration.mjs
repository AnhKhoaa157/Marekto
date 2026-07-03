// Shared safety utilities for the PostgreSQL-backed integration suite.
//
// The single most important guarantee here is that destructive operations
// (DROP SCHEMA, TRUNCATE, dropping roles) can only ever run against an
// explicitly isolated *test* database. If DATABASE_URL does not name a database
// that is clearly a throwaway test database, every helper throws before
// touching anything.

const TEST_DB_NAME_PATTERN = /(test|ci)/i;

/**
 * Parse the configured DATABASE_URL and confirm it points at a disposable test
 * database. Returns the database name. Throws otherwise so the harness fails
 * closed instead of mutating a real database.
 */
export function assertTestDatabase() {
  const rawUrl = process.env.DATABASE_URL?.trim();

  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL is required for integration tests and must point at an isolated test database.",
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }

  const databaseName = url.pathname.replace(/^\//, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  if (!TEST_DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to run destructive integration tests against database "${databaseName}". ` +
        'The database name must contain "test" or "ci" to prove it is disposable.',
    );
  }

  return databaseName;
}

/**
 * Reset the public schema to an empty state so schema initialization can be
 * exercised from a truly clean database. Guarded by assertTestDatabase().
 */
export async function resetPublicSchema(client) {
  assertTestDatabase();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  await client.query("GRANT ALL ON SCHEMA public TO public");
}

/**
 * Tables that carry a workspace_id and MUST be protected by FORCE ROW LEVEL
 * SECURITY. Kept in one place so every isolation test iterates the same set and
 * a newly added tenant table is easy to include.
 */
export const TENANT_OWNED_TABLES = Object.freeze([
  "Contacts",
  "Lists",
  "Contact_list_relation",
  "Templates",
  "Campaigns",
  "Email_logs",
  "Ai_outputs",
]);
