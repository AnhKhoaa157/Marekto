/**
 * Next.js loads this hook during server startup (not during `next build`).
 *
 * Database initialization is intentionally deferred to authenticated loaders and
 * API route handlers so unauthenticated page requests do not create a PostgreSQL
 * pool. The environment preflight below does NOT touch the database — it only
 * validates process configuration — so it preserves that deferral.
 *
 * In production the preflight fails closed for required/insecure auth, cron,
 * database, and malformed provider settings. Fully missing SMTP/Gemini config
 * remains a warning because the app already degrades to failed delivery logs or
 * safe non-AI behavior. In development every finding is warning-only.
 */
export async function register(): Promise<void> {
  // Only run in the Node.js server runtime; skip the Edge runtime (which cannot
  // load the SMTP validator) and the build phase (which never boots the server).
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const { checkEnvironment, assertEnvironment } = await import(
    "./src/lib/env-preflight.ts"
  );
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    // Throws a single, secret-free error listing every problem -> fail closed.
    const result = assertEnvironment(process.env, true);
    if (result.warnings.length > 0) {
      console.warn(
        `[env-preflight] ${result.warnings.length} warning(s):\n- ${result.warnings.join("\n- ")}`,
      );
    }
    console.log("[env-preflight] Production environment preflight passed.");
  } else {
    const result = checkEnvironment(process.env, false);
    for (const message of [...result.errors, ...result.warnings]) {
      console.warn(`[env-preflight] ${message}`);
    }
  }
}
