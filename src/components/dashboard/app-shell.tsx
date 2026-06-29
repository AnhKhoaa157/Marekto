import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";

export type AppRoute =
  | "/dashboard"
  | "/contacts"
  | "/lists"
  | "/campaigns"
  | "/templates";

type AppShellProps = {
  activeRoute: AppRoute;
  authenticated: boolean;
  children: ReactNode;
  eyebrow: string;
  headerActions?: ReactNode;
  title: string;
};

const navigationItems: ReadonlyArray<{ href: AppRoute; label: string }> = [
  { href: "/dashboard", label: "Overview" },
  { href: "/contacts", label: "Contacts" },
  { href: "/lists", label: "Lists" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/templates", label: "Templates" },
];

export function AppShell({
  activeRoute,
  authenticated,
  children,
  eyebrow,
  headerActions,
  title,
}: Readonly<AppShellProps>) {
  const showHeaderControls = Boolean(headerActions) || authenticated;

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-50">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-zinc-800 bg-zinc-950 px-4 py-4 lg:w-64 lg:border-b-0 lg:border-r lg:px-6 lg:py-6">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Workspace
              </p>
              <Link
                className="mt-1 inline-flex text-xl font-semibold tracking-tight text-zinc-50 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/dashboard"
              >
                Marekto
              </Link>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400">
              Tenant shell
            </div>
          </div>

          <nav
            aria-label="Primary navigation"
            className="mt-6 flex flex-wrap gap-2 lg:flex-col"
          >
            {navigationItems.map((item) => {
              const isActive = item.href === activeRoute;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "flex items-center rounded-md border border-indigo-500/30 bg-indigo-600 px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
                      : "flex items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium text-zinc-400 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                  }
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
            <div
              aria-disabled="true"
              className="flex cursor-not-allowed items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium text-zinc-600"
            >
              <span>Automation</span>
              <span className="text-xs font-normal">Unavailable</span>
            </div>
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-zinc-800 bg-zinc-950/95 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {eyebrow}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
                  {title}
                </h1>
              </div>

              {showHeaderControls ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {headerActions}
                  {authenticated ? <SignOutButton /> : null}
                </div>
              ) : null}
            </div>
          </header>

          <div className="flex-1 space-y-6 px-4 py-6 sm:px-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
