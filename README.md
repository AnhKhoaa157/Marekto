<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo/full/full-logo-dark.png">
    <img src="public/logo/full/full-logo.png" alt="Marekto" width="520">
  </picture>

  <p><strong>AI Marketing Workspace - plan, segment, create, send, and track personalized campaigns from real workspace data.</strong></p>

  <p>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js">
    <img alt="React" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-RLS-4169E1?logo=postgresql&logoColor=white">
    <img alt="Gemini" src="https://img.shields.io/badge/Gemini-2.5_Flash-8E75B2?logo=google&logoColor=white">
  </p>

  <p>
    <a href="#what-marekto-does">Product</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#verification">Verification</a>
  </p>
</div>

---

Marekto is an AI Marketing Workspace that helps teams plan, segment, create, send, and track personalized email campaigns from real workspace contact data. It combines campaign planning, AI-assisted audience building, reusable templates, scheduling, recipient-level personalization, and real SMTP delivery inside a multi-tenant workspace model. Workspace isolation is enforced with PostgreSQL Row-Level Security, not merely application-side filtering.

> **Truth over theatre.** Production screens use real API/database data, delivery logs represent real outcomes, and AI failures never create invented business results.

The next product direction is AI Campaign Builder: a review-first workflow that turns a campaign idea into a campaign brief, audience explanation, validated target filters, subject ideas, email HTML draft, AI personalization context, and schedule notes. Builder output must still be reviewed by a user and saved through the existing Template and Campaign draft flows; it must never auto-send or invent delivery results.

<div align="center">
  <img src="public/readme/marekto-ai-pipeline.png" alt="Marekto AI marketing pipeline from contacts through segmentation and personalized email delivery" width="100%">
  <sub>From contact signals to validated audiences, personalized messages, and real delivery outcomes.</sub>
</div>

## What Marekto does

```text
Campaign idea + contact data
   ↓
Workspace-isolated PostgreSQL storage
   ↓
AI Campaign Builder direction
   ↓
Natural-language audience request
   ↓
Gemini → validated campaign filters
   ↓
Scheduled campaign → atomic worker claim
   ↓
Per-recipient AI personalization
   ↓
Nodemailer SMTP delivery
   ↓
Real sent / failed delivery logs
```

### Current capabilities

| Area | What is implemented |
| --- | --- |
| Authentication | Registration with email OTP, login/logout, JWT sessions, and workspace-derived tenant context |
| Contacts | Real CRUD data with flexible JSONB properties |
| Lists | Workspace-scoped contact grouping and membership management |
| Templates | Reusable HTML email templates with create, update, and delete flows |
| Campaigns | Draft and scheduled campaigns with guarded status transitions |
| AI segmentation | Natural language converted into a strict, validated filter contract |
| AI personalization | Recipient-specific subject and HTML with a safe raw-template fallback |
| Delivery | Real Nodemailer SMTP sends with recipient-level outcomes |
| Automation | Atomic campaign claims, stale-claim recovery, and duplicate-send protection |
| Observability | Campaign delivery summaries, sanitized diagnostics, and email-log detail views |
| Tenant safety | PostgreSQL RLS plus `withWorkspace(...)` on tenant-scoped database access |

### Still on the roadmap

- AI Campaign Builder for campaign briefs, audience plans, email drafts, and draft creation
- AI lead scoring and contact enrichment
- Campaign-specific AI context such as goal, tone, CTA, and language
- Workspace-level brand voice settings
- Prompt-version-aware AI cache and delivery audit data
- Admin operations console

## Architecture

```mermaid
flowchart LR
    BROWSER["Browser"] --> PROXY["JWT proxy"]
    PROXY --> API["App Router APIs"]
    API --> CONTEXT["withWorkspace()"]
    CONTEXT --> DB["PostgreSQL + RLS"]
    API --> AI["Gemini 2.5 Flash"]

    CRON["Authenticated cron trigger"] --> WORKER["Campaign worker"]
    WORKER --> CONTEXT
    WORKER --> AI
    WORKER --> SMTP["Nodemailer / SMTP"]
    SMTP --> LOGS["Email_logs"]
    LOGS --> DB
```

<div align="center">
  <img src="public/readme/marekto-tenant-isolation.png" alt="Marekto workspace isolation and protected multi-tenant data architecture" width="100%">
  <sub>Each workspace stays inside its own trusted data boundary.</sub>
</div>

### Tenant request lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant P as Proxy
    participant A as API route
    participant W as withWorkspace
    participant D as PostgreSQL / RLS

    B->>P: Request with auth cookie
    P->>P: Verify JWT and resolve workspace
    P->>A: Forward trusted workspace context
    A->>A: Validate input and workspace ID
    A->>W: Run tenant-scoped operation
    W->>D: BEGIN + set RLS workspace context
    D-->>W: Workspace-isolated rows
    W-->>A: Typed result
    A-->>B: { success, data | error }
```

The browser never selects a workspace directly. The verified token establishes tenant context before database access, and PostgreSQL RLS remains the final data boundary.

### Campaign execution lifecycle

```mermaid
flowchart TD
    INPUT["Natural-language audience"] --> SEGMENT["Gemini segmentation"]
    SEGMENT --> VALIDATE["Strict filter validation"]
    VALIDATE --> SAVE["Campaign target_filters"]
    SAVE --> QUEUE["pending + run_at"]
    QUEUE --> TRIGGER["Authenticated worker trigger"]
    TRIGGER --> CLAIM["Atomic claim + stale lease recovery"]
    CLAIM --> MATCH["Parameterized contact selection"]
    MATCH --> PERSONALIZE["Per-contact personalization"]
    PERSONALIZE -->|Valid AI output| SEND["SMTP send"]
    PERSONALIZE -->|AI failure| FALLBACK["Original template"]
    FALLBACK --> SEND
    SEND --> OUTCOME["Recipient sent / failed log"]
    OUTCOME --> STATUS["Truthful campaign status"]
```

Segmentation cache fallback is exact-match and workspace-scoped. Personalization fallback never fabricates copy: it sends the original stored template.

### Core engineering rules

- Every tenant-owned query runs through `withWorkspace(workspaceId, ...)`.
- SQL values use placeholders; user input is never interpolated into SQL.
- JSONB AI output is validated before persistence or delivery.
- Segmentation falls back only to a validated exact-match workspace cache.
- Personalization falls back to the original real template when AI fails.
- Campaigns are marked sent only from confirmed delivery outcomes.
- Secrets and raw provider errors are sanitized before logging.

## Technology

| Layer | Stack |
| --- | --- |
| Web application | Next.js App Router, React, Tailwind CSS |
| Language | TypeScript in strict mode |
| Database | PostgreSQL, raw parameterized SQL, JSONB, Row-Level Security |
| AI | Gemini 2.5 Flash with structured JSON responses |
| Email | Nodemailer over SMTP |
| Scheduling | Authenticated cron-compatible worker route |
| API reference | OpenAPI and Swagger UI at `/api-docs` |
| Tests | Node.js test runner with TypeScript type stripping |

## Quick start

### 1. Install

```bash
git clone https://github.com/AnhKhoaa157/Marekto.git
cd Marekto
npm install
```

### 2. Configure the environment

Create `.env` in the project root. Never commit real credentials.

```dotenv
# Required application infrastructure
DATABASE_URL=postgresql://postgres:password@localhost:5432/marekto
JWT_SECRET=replace-with-a-long-random-secret

# Database transport (optional locally)
DATABASE_SSL=false

# Gemini — required for live AI generation
GEMINI_API_KEY=
GEMINI_FALLBACK_API_KEYS=
GEMINI_TIMEOUT_MS=20000

# SMTP — required for registration OTP and campaign delivery
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Required for worker authentication in production
CRON_SECRET=
```

Flyway manages versioned schema migrations from `db/migrations`. The application still keeps an idempotent startup initializer for compatibility and for the default admin seed.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Interactive API documentation is available at [http://localhost:3000/api-docs](http://localhost:3000/api-docs).

### Docker local stack

The repository includes a Docker Compose setup for local development:

- `web`: Next.js app on port `3000`
- `postgres`: PostgreSQL 16 on port `5432`
- `flyway`: applies `db/migrations` before the web app starts
- `data-intelligence`: internal FastAPI service on port `8080`

Start the stack:

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000). Flyway applies the database schema first, and the app creates the default admin account when it first touches the database.

Run database migrations or inspect migration history manually:

```bash
npm run db:migrate
npm run db:info
npm run db:validate
```

Docker uses safe local defaults from `docker/env.example`. To customize secrets or provider credentials without editing the committed example, copy it to a local file and point Compose at it:

```bash
cp docker/env.example docker/env.local
MAREKTO_DOCKER_ENV_FILE=./docker/env.local docker compose up --build
```

PowerShell equivalent:

```powershell
Copy-Item docker/env.example docker/env.local
$env:MAREKTO_DOCKER_ENV_FILE = "./docker/env.local"
docker compose up --build
```

Stop the stack:

```bash
docker compose down
```

Remove the local PostgreSQL data volume when you need a clean database:

```bash
docker compose down -v
```

## Product surfaces

| Route | Purpose |
| --- | --- |
| `/dashboard` | Real workspace and delivery metrics |
| `/contacts` | Contact management and dynamic properties |
| `/lists` | Reusable contact groups |
| `/templates` | HTML email template management |
| `/campaigns` | Campaign creation, scheduling, targeting, and delivery status |
| `/campaigns/:id` | Recipient-level delivery logs and diagnostics |
| `/api-docs` | Interactive OpenAPI reference |

## Verification

Run the same checks expected for every production change:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

The database isolation integration test requires a configured PostgreSQL instance and a role capable of creating the temporary restricted test role. Without that environment, it is intentionally skipped.

## Project layout

```text
Marekto/
|-- src/
|   |-- app/
|   |   |-- api/
|   |   |   |-- auth/
|   |   |   |-- ai/segmentation/
|   |   |   |-- campaigns/
|   |   |   |-- contacts/
|   |   |   |-- lists/
|   |   |   |-- templates/
|   |   |   `-- worker/cron/
|   |   |-- campaigns/
|   |   |-- contacts/
|   |   |-- dashboard/
|   |   |-- lists/
|   |   `-- templates/
|   |-- components/
|   |   |-- auth/
|   |   |-- brand/
|   |   |-- dashboard/
|   |   |-- homepage/
|   |   `-- resources/
|   |-- lib/
|   |   |-- ai/prompts/
|   |   |-- mail/
|   |   |-- campaign-filters.ts
|   |   |-- campaign-worker.ts
|   |   |-- db.ts
|   |   `-- openapi.ts
|   `-- proxy.ts
|-- tests/
|-- public/
|-- instrumentation.ts
|-- package.json
`-- next.config.ts
```

### Responsibility map

| If you are changing... | Start here |
| --- | --- |
| Authentication or tenant routing | `src/proxy.ts`, `src/lib/auth.ts`, `src/app/api/auth/` |
| Database schema or RLS | `src/lib/db.ts` and tenant-isolation tests |
| Audience filter behavior | `src/lib/campaign-filters.ts`, `src/lib/ai/segmentation.ts` |
| AI prompt wording | `src/lib/ai/prompts/` and `tests/ai-prompts.test.mjs` |
| Campaign delivery | `src/app/api/worker/cron/`, `src/lib/campaign-worker.ts` |
| SMTP behavior | `src/lib/mail/` and `tests/mail.test.mjs` |
| Resource UI | `src/components/resources/` and its matching `src/app/` route |
| Public API contract | `src/lib/openapi.ts` and `/api-docs` |

## Security notes

- The browser does not choose its workspace. Tenant context comes from the verified JWT.
- SMTP, Gemini, database, JWT, and cron credentials stay server-side.
- Worker logs redact common credential formats and do not emit raw error stacks.
- Running the worker can send real email when due campaigns and SMTP credentials exist.
- AI output is untrusted input until it passes the corresponding runtime validator.

---

<div align="center">
  <strong>Built for real campaigns, real tenants, and real delivery outcomes.</strong>
</div>
