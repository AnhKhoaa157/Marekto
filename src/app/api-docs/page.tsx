"use client";

import dynamic from "next/dynamic";

import { openApiSpec } from "@/lib/openapi";
import "swagger-ui-react/swagger-ui.css";

// swagger-ui-react relies on browser-only APIs and legacy lifecycles that break
// under React 19 server rendering, so it is loaded client-side only.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => (
    <p className="px-6 py-10 text-sm text-zinc-500">Loading API documentation…</p>
  ),
});

export default function ApiDocsPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] bg-white px-6 py-5 dark:border-white/[.145] dark:bg-zinc-950">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Marekto API Documentation
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Interactive OpenAPI 3.0 reference. Authenticate with a JWT via the
            Authorize button to try tenant-scoped endpoints.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-2 py-6 sm:px-6">
        <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white shadow-sm dark:border-white/[.145] dark:bg-white">
          <SwaggerUI spec={openApiSpec} />
        </div>
      </main>
    </div>
  );
}
