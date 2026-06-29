/**
 * Next.js loads this hook during server startup. Database initialization is
 * intentionally deferred to authenticated loaders and API route handlers so
 * unauthenticated page requests do not create a PostgreSQL pool.
 */
export function register(): void {}
