import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { BackToTop } from "@/components/homepage/back-to-top";
import { Hero3DVisual } from "@/components/homepage/hero-3d-visual";

export const metadata: Metadata = {
  title: "Marekto — AI-powered marketing automation",
  description:
    "Marekto helps marketing teams enrich contacts, segment audiences, schedule campaigns, personalize emails with AI, and deliver securely across isolated workspaces.",
};

type IconProps = Readonly<{ className?: string }>;

function ContactsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8M17.5 19a5 5 0 0 0-3-4.6" />
    </svg>
  );
}

function ScoreIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

function SegmentIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5l6 4" />
    </svg>
  );
}

function CampaignIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6l13 4V5z" />
      <path d="M4 12H3M17 9l3-2M17 15l3 2" />
    </svg>
  );
}

function MailIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 5 6v5c0 4.4 2.9 7.6 7 9 4.1-1.4 7-4.6 7-9V6z" />
      <path d="m9.5 12 1.8 1.8L15 10.5" />
    </svg>
  );
}

function DatabaseIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </svg>
  );
}

function LockIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="10" width="14" height="10" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.5" />
    </svg>
  );
}

function ArrowIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const navLinks: ReadonlyArray<{ href: string; label: string }> = [
  { href: "#product", label: "Product" },
  { href: "#flow", label: "Flow" },
  { href: "#security", label: "Security" },
];

const flowSteps: ReadonlyArray<{ title: string; description: string }> = [
  {
    title: "Contact ingestion",
    description:
      "Raw customer records enter through the contacts API with fixed identity fields.",
  },
  {
    title: "AI lead scoring",
    description:
      "Each contact is analyzed to produce a validated lead score and tags.",
  },
  {
    title: "JSONB enrichment",
    description:
      "Dynamic attributes are stored in the contacts properties JSONB column.",
  },
  {
    title: "AI segmentation",
    description:
      "A plain-language audience request becomes a structured target filter.",
  },
  {
    title: "Campaign scheduling",
    description:
      "Campaigns hold their filter and run-at time until they are due.",
  },
  {
    title: "AI personalization",
    description:
      "Per-contact email content is generated at send time for each match.",
  },
  {
    title: "SMTP delivery",
    description:
      "Generated emails are delivered over SMTP and the result is recorded.",
  },
];

const features: ReadonlyArray<{
  title: string;
  description: string;
  icon: (props: IconProps) => ReactNode;
}> = [
  {
    title: "Dynamic contacts",
    description:
      "Store fixed identity fields plus evolving attributes in JSONB, so new data points never require a schema migration.",
    icon: ContactsIcon,
  },
  {
    title: "AI lead scoring",
    description:
      "Turn raw contact data into a validated lead score and tags that enrich each record automatically.",
    icon: ScoreIcon,
  },
  {
    title: "Natural-language segmentation",
    description:
      "Describe an audience in plain language and let AI translate it into a safe, operator-whitelisted filter.",
    icon: SegmentIcon,
  },
  {
    title: "Campaign scheduling",
    description:
      "Queue campaigns with a run-at time; a background runner picks up due work and processes it reliably.",
    icon: CampaignIcon,
  },
  {
    title: "AI email personalization",
    description:
      "Generate per-contact email content at send time instead of shipping one generic message to everyone.",
    icon: MailIcon,
  },
  {
    title: "Multi-tenant isolation",
    description:
      "Every workspace is a separate tenant boundary, kept isolated in the database rather than only in app code.",
    icon: ShieldIcon,
  },
];

const securityPoints: ReadonlyArray<{
  title: string;
  description: string;
  icon: (props: IconProps) => ReactNode;
}> = [
  {
    title: "Workspace tenant isolation",
    description:
      "Workspaces are the tenant boundary. Every tenant-scoped row belongs to exactly one workspace.",
    icon: ShieldIcon,
  },
  {
    title: "PostgreSQL Row-Level Security",
    description:
      "Isolation is enforced natively in PostgreSQL with RLS policies, not only in application logic.",
    icon: DatabaseIcon,
  },
  {
    title: "Auth-protected APIs",
    description:
      "Tenant-scoped routes verify a session and resolve workspace context before any data is read or written.",
    icon: LockIcon,
  },
  {
    title: "Real data isolation",
    description:
      "Clients never choose their workspace manually; the auth layer resolves and injects the verified context.",
    icon: SegmentIcon,
  },
];

const heroFlowCards: ReadonlyArray<{
  label: string;
  caption: string;
  icon: (props: IconProps) => ReactNode;
}> = [
  { label: "Contacts", caption: "Ingested records", icon: ContactsIcon },
  { label: "AI scoring", caption: "Validated lead score", icon: ScoreIcon },
  { label: "Segmentation", caption: "Plain-language filter", icon: SegmentIcon },
  { label: "Campaign", caption: "Scheduled run-at", icon: CampaignIcon },
  { label: "Personalized email", caption: "Per-contact content", icon: MailIcon },
];

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
      >
        <Link
          aria-label="Marekto home"
          className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          href="/"
        >
          <BrandLogo className="h-10 w-28" priority sizes="112px" />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((item) => (
            <a
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-400 outline-none transition-colors hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            className="rounded-md px-3 py-2 text-sm font-medium text-zinc-300 outline-none transition-colors hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href="/login"
          >
            Sign in
          </Link>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href="/register"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-800/80">
      <div
        aria-hidden="true"
        className="marekto-grid marekto-grid-fade pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl sm:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-32 hidden h-64 w-64 rounded-full bg-blue-600/10 blur-3xl lg:block"
      />

      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-10 lg:px-8 lg:py-28">
        <div className="marekto-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            Multi-tenant marketing automation
          </span>

          <h1 className="mt-6 text-balance text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl">
            AI-powered marketing automation for smarter lead journeys
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-zinc-400 sm:text-lg">
            Marekto helps marketing teams enrich contacts with AI, segment
            audiences in plain language, schedule campaigns, personalize email
            content per contact, and send securely across fully isolated
            workspaces.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-6 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/register"
            >
              Get started
              <ArrowIcon className="h-4 w-4" />
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-700 px-6 text-sm font-medium text-zinc-200 outline-none transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/login"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-6 text-sm text-zinc-500">
            Workspace data stays isolated with PostgreSQL Row-Level Security.
          </p>
        </div>

        <div className="marekto-fade-up rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-2xl shadow-indigo-950/30 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-cyan-400"
              />
              <p className="text-sm font-medium text-zinc-200">
                AI Lead Journey Engine
              </p>
            </div>
            <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-medium text-zinc-500">
              Conceptual
            </span>
          </div>

          <div className="marekto-hero-stage relative mt-4 aspect-[5/4] w-full overflow-hidden rounded-xl border border-zinc-800/80">
            <Hero3DVisual>
              <HeroFallbackVisual />
            </Hero3DVisual>
          </div>

          <ul className="mt-4 flex flex-wrap gap-2">
            {heroFlowCards.map((card) => {
              const Icon = card.icon;

              return (
                <li
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-xs font-medium text-zinc-300"
                  key={card.label}
                >
                  <Icon className="h-3.5 w-3.5 text-indigo-300" />
                  {card.label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function HeroFallbackVisual() {
  return (
    <svg
      aria-label="Conceptual Marekto lead journey: contacts stream down an AI segmentation funnel into a delivery core that sends personalized email."
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox="0 0 400 320"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="funnelStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Funnel walls */}
      <path
        d="M58 74 L188 250"
        stroke="url(#funnelStroke)"
        strokeWidth="1"
        opacity="0.3"
        fill="none"
      />
      <path
        d="M342 74 L212 250"
        stroke="url(#funnelStroke)"
        strokeWidth="1"
        opacity="0.3"
        fill="none"
      />

      {/* Stacked perspective rings (segmentation funnel) */}
      {[
        { y: 74, rx: 142, o: 0.45 },
        { y: 98, rx: 120, o: 0.42 },
        { y: 122, rx: 99, o: 0.39 },
        { y: 148, rx: 79, o: 0.36 },
        { y: 174, rx: 60, o: 0.33 },
        { y: 200, rx: 43, o: 0.3 },
        { y: 226, rx: 27, o: 0.27 },
        { y: 248, rx: 14, o: 0.24 },
      ].map((ring) => (
        <ellipse
          key={ring.y}
          cx="200"
          cy={ring.y}
          rx={ring.rx}
          ry={ring.rx * 0.3}
          fill="none"
          stroke="url(#funnelStroke)"
          strokeWidth="1.5"
          opacity={ring.o}
        />
      ))}

      {/* Orbiting AI nodes with beams to the core */}
      {[
        { x: 96, y: 120 },
        { x: 320, y: 150 },
        { x: 128, y: 206 },
        { x: 296, y: 210 },
      ].map((node) => (
        <g key={`${node.x}-${node.y}`}>
          <line
            x1={node.x}
            y1={node.y}
            x2="200"
            y2="250"
            stroke="#3b82f6"
            strokeWidth="1"
            opacity="0.22"
          />
          <circle cx={node.x} cy={node.y} r="14" fill="url(#nodeGlow)" />
          <circle cx={node.x} cy={node.y} r="3.5" fill="#2dd4bf" />
        </g>
      ))}

      {/* Lead particles streaming down the funnel */}
      {[
        { x: 150, y: 96 },
        { x: 250, y: 110 },
        { x: 176, y: 150 },
        { x: 232, y: 168 },
        { x: 196, y: 200 },
        { x: 210, y: 224 },
      ].map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="2.4"
          fill="#818cf8"
          opacity="0.85"
        />
      ))}

      {/* Converging delivery core */}
      <circle cx="200" cy="250" r="26" fill="url(#coreGlow)" />
      <circle cx="200" cy="250" r="5" fill="#a5f3fc" />

      {/* Delivery arc + envelope (personalized email) */}
      <path
        d="M200 250 Q270 196 320 244"
        stroke="#22d3ee"
        strokeWidth="1.5"
        opacity="0.45"
        fill="none"
      />
      <g
        stroke="#2dd4bf"
        strokeWidth="1.5"
        fill="none"
        opacity="0.85"
        strokeLinejoin="round"
      >
        <rect x="296" y="232" width="48" height="32" rx="3" />
        <path d="M296 234 L320 252 L344 234" />
      </g>
    </svg>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-7 text-zinc-400">{description}</p>
    </div>
  );
}

function FlowSection() {
  return (
    <section id="flow" className="border-b border-zinc-800/80 scroll-mt-20">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Product flow"
          title="From raw contact to personalized send"
          description="Marekto moves each contact through a clear, automated pipeline — every step is real product behavior, not a marketing abstraction."
        />

        <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {flowSteps.map((step, index) => (
            <li
              className="relative rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
              key={step.title}
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-indigo-500/30 bg-indigo-500/10 text-sm font-semibold text-indigo-300">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-base font-semibold text-zinc-50">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="product" className="border-b border-zinc-800/80 scroll-mt-20">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Core features"
          title="Everything a lead journey needs"
          description="A focused toolset for turning messy contact data into targeted, personalized campaigns — without writing SQL or maintaining rigid schemas."
        />

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                className="group rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 transition-colors hover:border-zinc-700"
                key={feature.title}
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-zinc-50">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section id="security" className="border-b border-zinc-800/80 scroll-mt-20">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
              Security &amp; multi-tenancy
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Isolation enforced in the database, not just the app
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-400">
              Multi-tenancy is a core design decision in Marekto. Workspaces are
              the tenant boundary, and PostgreSQL Row-Level Security keeps each
              workspace&apos;s data separated at the data layer — so isolation
              does not depend on remembering to filter in every query.
            </p>
            <p className="mt-4 text-sm leading-6 text-zinc-500">
              These are architectural properties of the platform, described
              honestly — not compliance certifications.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {securityPoints.map((point) => {
              const Icon = point.icon;

              return (
                <article
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
                  key={point.title}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-zinc-50">
                    {point.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {point.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-b border-zinc-800/80">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 left-1/2 hidden h-56 w-56 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl sm:block"
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Build smarter lead journeys in your own isolated workspace
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-zinc-400">
              Create a workspace to start enriching contacts, segmenting
              audiences, and sending personalized campaigns with AI.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-6 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/register"
              >
                Get started
                <ArrowIcon className="h-4 w-4" />
              </Link>
              <Link
                className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-700 px-6 text-sm font-medium text-zinc-200 outline-none transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/login"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const footerProductLinks: ReadonlyArray<{ href: string; label: string }> = [
  { href: "#product", label: "Product" },
  { href: "#flow", label: "Flow" },
  { href: "#security", label: "Security" },
  { href: "/register", label: "Get started" },
];

const footerAppLinks: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/login", label: "Login" },
  { href: "/register", label: "Register" },
  { href: "/dashboard", label: "Dashboard" },
];

const footerPlatformSummary: ReadonlyArray<string> = [
  "AI lead scoring",
  "Smart segmentation",
  "Campaign scheduling",
  "Personalized email delivery",
];

const footerSecuritySummary: ReadonlyArray<string> = [
  "Multi-tenant workspaces",
  "PostgreSQL RLS",
  "Auth-protected APIs",
];

function isInternalHref(href: string): boolean {
  return href.startsWith("/");
}

function FooterLinkColumn({
  title,
  links,
}: Readonly<{
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
}>) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            {isInternalHref(link.href) ? (
              <Link
                className="rounded-md text-sm text-zinc-400 outline-none transition-colors hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href={link.href}
              >
                {link.label}
              </Link>
            ) : (
              <a
                className="rounded-md text-sm text-zinc-400 outline-none transition-colors hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href={link.href}
              >
                {link.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterSummaryColumn({
  title,
  items,
}: Readonly<{
  title: string;
  items: ReadonlyArray<string>;
}>) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li className="text-sm text-zinc-400" key={`${title}-${item}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-zinc-800/80">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-12">
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <BrandLogo className="h-11 w-32" sizes="128px" />
            <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-400">
              Marekto is a multi-tenant, AI-powered marketing automation
              platform for enriching contacts, segmenting audiences, and sending
              personalized campaigns across fully isolated workspaces.
            </p>
          </div>

          <div className="lg:col-span-2">
            <FooterLinkColumn title="Product" links={footerProductLinks} />
          </div>
          <div className="lg:col-span-2">
            <FooterLinkColumn title="App" links={footerAppLinks} />
          </div>
          <div className="lg:col-span-2">
            <FooterSummaryColumn
              title="Platform"
              items={footerPlatformSummary}
            />
          </div>
          <div className="lg:col-span-2">
            <FooterSummaryColumn
              title="Security"
              items={footerSecuritySummary}
            />
          </div>
        </div>

        <div className="mt-12 border-t border-zinc-800/80 pt-6">
          <p className="text-sm text-zinc-500">
            © 2026 Marekto. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-50">
      <Navbar />
      <main>
        <Hero />
        <FlowSection />
        <FeaturesSection />
        <SecuritySection />
        <FinalCta />
      </main>
      <Footer />
      <BackToTop />
    </div>
  );
}
