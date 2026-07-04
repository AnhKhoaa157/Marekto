"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminRoute =
  | "/admin"
  | "/admin/workspaces"
  | "/admin/users"
  | "/admin/delivery-diagnostics"
  | "/admin/health";

type AdminNavLinkProps = {
  href: AdminRoute;
  label: string;
};

export function AdminNavLink({ href, label }: Readonly<AdminNavLinkProps>) {
  const pathname = usePathname();
  const isActive =
    pathname === href ||
    (href !== "/admin" && pathname.startsWith(`${href}/`));

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? "flex items-center justify-between gap-3 rounded-md border border-indigo-500/30 bg-indigo-600 px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          : "flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium text-zinc-400 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
      }
      href={href}
      prefetch
    >
      <span>{label}</span>
    </Link>
  );
}
