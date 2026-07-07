import Link from "next/link";
import type { ReactNode } from "react";

import {
  AdminNavLink,
  type AdminRoute,
} from "@/components/admin/admin-nav-link";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

type AdminShellProps = {
  activeRoute: AdminRoute;
  adminEmail: string;
  children: ReactNode;
  eyebrow: string;
  title: string;
};

const navigationItems: ReadonlyArray<{ href: AdminRoute; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/billing-plans", label: "Billing plans" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/delivery-diagnostics", label: "Delivery diagnostics" },
  { href: "/admin/health", label: "System health" },
];

export function AdminShell({
  activeRoute,
  adminEmail,
  children,
  eyebrow,
  title,
}: Readonly<AdminShellProps>) {
  void activeRoute;

  return (
    <main className="h-dvh overflow-hidden bg-zinc-950 text-zinc-50">
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="marekto-scrollbar shrink-0 overflow-y-auto overscroll-contain border-b border-zinc-800 bg-zinc-950 px-4 py-4 lg:h-full lg:w-64 lg:border-b-0 lg:border-r lg:px-6 lg:py-6">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Marekto
              </p>
              <Link
                className="mt-1 inline-flex text-xl font-semibold tracking-tight text-zinc-50 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/admin"
              >
                Admin console
              </Link>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              Admin
            </div>
          </div>

          <nav
            aria-label="Admin navigation"
            className="mt-6 flex flex-wrap gap-2 lg:flex-col"
          >
            {navigationItems.map((item) => (
              <AdminNavLink href={item.href} key={item.href} label={item.label} />
            ))}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/95 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {eyebrow}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
                  {title}
                </h1>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span
                  className="truncate rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400"
                  title={adminEmail}
                >
                  {adminEmail}
                </span>
                <SignOutButton />
              </div>
            </div>
          </header>

          <div className="marekto-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
