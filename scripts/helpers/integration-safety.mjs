// Shared safety guard for destructive test/smoke tooling: refuse to run unless
// DATABASE_URL clearly names a disposable *test* database. Kept dependency-free
// so both npm scripts and the test suite can rely on the same guarantee.

const TEST_DB_NAME_PATTERN = /(test|ci)/i;

export function assertTestDatabase() {
  const rawUrl = process.env.DATABASE_URL?.trim();

  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL is required and must point at an isolated test database.",
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
      `Refusing to run destructive tooling against database "${databaseName}". ` +
        'The database name must contain "test" or "ci" to prove it is disposable.',
    );
  }

  return databaseName;
}
