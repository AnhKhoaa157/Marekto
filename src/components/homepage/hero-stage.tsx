"use client";

import { type ReactNode, useState } from "react";

import { Hero3DVisual } from "@/components/homepage/hero-3d-visual";

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

export type ActiveSectionType = "contacts" | "scoring" | "segmentation" | "campaign" | "email";

const heroFlowCards: ReadonlyArray<{
  id: ActiveSectionType;
  label: string;
  caption: string;
  icon: (props: IconProps) => ReactNode;
}> = [
  { id: "contacts", label: "Contacts", caption: "Ingested records", icon: ContactsIcon },
  { id: "scoring", label: "AI scoring", caption: "Validated lead score", icon: ScoreIcon },
  { id: "segmentation", label: "Segmentation", caption: "Plain-language filter", icon: SegmentIcon },
  { id: "campaign", label: "Campaign", caption: "Scheduled run-at", icon: CampaignIcon },
  { id: "email", label: "Personalized email", caption: "Per-contact content", icon: MailIcon },
];

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

export function HeroStage() {
  const [activeSection, setActiveSection] = useState<ActiveSectionType | null>(null);

  return (
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
          Interactive
        </span>
      </div>

      <div className="marekto-hero-stage relative mt-4 aspect-[5/4] w-full overflow-hidden rounded-xl border border-zinc-800/80">
        <Hero3DVisual activeSection={activeSection}>
          <HeroFallbackVisual />
        </Hero3DVisual>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {heroFlowCards.map((card) => {
          const Icon = card.icon;
          const isActive = activeSection === card.id;

          return (
            <li
              className={`inline-flex cursor-default items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-300 ${
                isActive
                  ? "border-indigo-500/50 bg-indigo-600/20 text-indigo-200 shadow-lg shadow-indigo-950/50 scale-[1.03]"
                  : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
              key={card.id}
              onMouseEnter={() => setActiveSection(card.id)}
              onMouseLeave={() => setActiveSection(null)}
            >
              <Icon className={`h-3.5 w-3.5 transition-colors ${isActive ? "text-indigo-300" : "text-zinc-500 group-hover:text-zinc-400"}`} />
              {card.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
