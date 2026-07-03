#!/usr/bin/env node
// Apply the canonical, idempotent schema + migrations to the database named by
// DATABASE_URL. This runs the exact same initializeDatabase() path the app uses
// at startup, so operators and CI use one source of truth for schema state.
//
// Safe to run repeatedly: initializeDatabase() is built from
// CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded DO blocks and
// records the applied MIGRATION_VERSION in "Schema_migrations".
//
// Usage:
//   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/apply-schema.mjs
import process from "node:process";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[apply-schema] DATABASE_URL is required.");
    process.exit(1);
  }

  const { initializeDatabase, pool } = await import("../src/lib/db.ts");

  try {
    await initializeDatabase();
    console.log("[apply-schema] Schema initialization completed successfully.");
  } catch (error) {
    console.error(
      "[apply-schema] Schema initialization failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

void main();
