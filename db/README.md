# Database Migrations

Marekto uses Flyway for versioned PostgreSQL schema history.

## Commands

```bash
npm run db:migrate
npm run db:info
npm run db:validate
```

The npm commands run the official Flyway Docker image through `docker compose`,
so local development does not require Java or a global Flyway install.

## Migration Rules

- Put migrations in `db/migrations`.
- Use Flyway naming: `V{number}__short_description.sql`.
- Never edit a migration after it has been applied to a shared database.
- Add a new migration for every schema change.
- Keep application data seeds out of schema migrations unless the seed is truly
  static. The default admin account is still created by application code because
  password hashing belongs to the Node auth layer.

## Current Baseline

`V001__baseline_schema.sql` represents the current UUID-based schema after
Phase 17 limits and entitlements. Fresh Docker databases apply this migration
before the web app starts. Existing non-empty databases without Flyway history
are baselined at version `1`, so Flyway starts tracking future migrations
without replaying the baseline over live tables.
