#!/usr/bin/env node
// Cross-platform runner for the PostgreSQL-backed integration suite.
//
// These tests are deliberately separated from `npm test` (the fast unit and
// contract suite). They require a real, disposable PostgreSQL database and only
// run when RUN_DB_INTEGRATION_TESTS=1 is set, which this runner does for you.
//
// A DATABASE_URL pointing at an ISOLATED test database is required. The runner
// refuses to continue without it so the harness can never touch a developer's
// primary database. See docs/backend/INTEGRATION_TESTING.md for setup.
import { spawnSync } from "node:child_process";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    "[integration] DATABASE_URL is not set. Point it at an isolated, disposable " +
      "test database before running the integration suite. See " +
      "docs/backend/INTEGRATION_TESTING.md.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--test",
    // Integration test files share one disposable database, so they must run
    // one file at a time to avoid cross-file DDL/DROP races.
    "--test-concurrency=1",
    "--experimental-strip-types",
    "tests/*.integration.test.mjs",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RUN_DB_INTEGRATION_TESTS: "1" },
  },
);

if (result.error) {
  console.error("[integration] Failed to launch the test runner:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
