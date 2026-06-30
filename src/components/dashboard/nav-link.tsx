"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { AppRoute } from "@/components/dashboard/app-shell";

type NavLinkProps = {
  href: AppRoute;
  label: string;
};

export function NavLink({ href, label }: Readonly<NavLinkProps>) {
  const pathname = usePathname();
  const [pendingNavigation, setPendingNavigation] = useState<{
    fromPath: string;
    href: AppRoute;
  } | null>(null);
  const isActive = pathname === href;
  const isPending =
    pendingNavigation?.href === href &&
    pendingNavigation.fromPath === pathname &&
    !isActive;

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      aria-busy={isPending || undefined}
      className={
        isActive || isPending
          ? "flex items-center justify-between gap-3 rounded-md border border-indigo-500/30 bg-indigo-600 px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          : "flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium text-zinc-400 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
      }
      href={href}
      onClick={() => {
        if (!isActive) {
          setPendingNavigation({ fromPath: pathname, href });
        }
      }}
      prefetch
    >
      <span>{label}</span>
      {isPending ? (
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-100" />
      ) : null}
    </Link>
  );
}
