import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// System (non-tenant) API roots are intentionally excluded from the tenant
// proxy matcher. `admin` carries its own server-side administrator authorization
// (`@/lib/admin-session`) and must NOT be tenant-scoped: injecting a single
// `x-workspace-id` would misrepresent its cross-tenant reads.
const SYSTEM_API_ROOTS = new Set(["auth", "openapi.json", "worker", "admin"]);

test("every tenant API root is listed in the proxy matcher", async () => {
  const apiRoot = path.resolve("src/app/api");
  const proxySource = await readFile(path.resolve("src/proxy.ts"), "utf8");
  const entries = await readdir(apiRoot, { withFileTypes: true });
  const tenantRoots = entries
    .filter((entry) => entry.isDirectory() && !SYSTEM_API_ROOTS.has(entry.name))
    .map((entry) => entry.name);

  for (const root of tenantRoots) {
    assert.match(
      proxySource,
      new RegExp(`\\"/api/${root.replace(".", "\\.")}/:path\\*\\"`),
      `Missing proxy matcher for /api/${root}`,
    );
  }
});
