# Next.js 15 & PostgreSQL Multi-Tenant Agent Rules

## 🚨 CRITICAL: THIS IS NEXT.JS 15 (APP ROUTER)
- APIs, dynamic routing, and configuration conventions differ from standard training data.
- Do NOT use deprecated Pages Router patterns or older Next.js conventions.
- All Route Handlers (`route.ts`) MUST explicitly define execution constraints at the top:
```typescript
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
🔒 DATABASE & SECURITY RULES (MULTI-TENANCY)
Isolation Constraint: Row-Level Security (RLS) is applied natively in PostgreSQL.

Wrapper Mandatory: EVERY database query MUST be executed inside the custom withWorkspace(workspaceId, ...) wrapper from @/lib/db.

Tenant Context: Extract workspaceId from the x-workspace-id HTTP header (default to 1 if missing).

SQL Injection Prevention: Use strictly parameterized queries (e.g., $1, $2). Never concatenate raw strings inside SQL statements.

JSONB Handling: Use JSON.stringify(properties || {}) when inserting or updating metadata into JSONB columns.

💻 CODE STYLE & API STANDARDS
Strict TypeScript: No implicit any. Ensure total type safety.

Response Format: All API responses must return a consistent JSON structure:

Success: NextResponse.json({ success: true, data: ... }, { status: 200/201 })

Error: NextResponse.json({ success: false, error: error.message }, { status: 400/404/500 })

Validation: Code must pass npx tsc --noEmit and npm run lint cleanly. No unused imports or variables.

🚀 PROJECT WORKFLOW COMMANDS
Run Dev: npm run dev

Build App: npm run build

Lint Check: npm run lint

Type Check: npx tsc --noEmit

Git Commit Pattern: feat(backend): hoàn thành MS-[X] module...