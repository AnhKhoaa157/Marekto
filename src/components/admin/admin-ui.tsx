import Link from "next/link";
import type { ReactNode } from "react";

export function AdminSectionHeading({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

export function AdminStatCard({
  title,
  value,
  description,
  valueClassName = "text-zinc-50",
}: Readonly<{
  title: string;
  value: string;
  description: string;
  valueClassName?: string;
}>) {
  return (
    <article className="flex flex-col rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${valueClassName}`}>
        {value}
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-500">{description}</p>
    </article>
  );
}

export function AdminConfigPill({
  ok,
  okLabel = "Configured",
  offLabel = "Not configured",
}: Readonly<{ ok: boolean; okLabel?: string; offLabel?: string }>) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300"
          : "inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-400"
      }
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-500"}`}
      />
      {ok ? okLabel : offLabel}
    </span>
  );
}

export function AdminEmpty({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

export function AdminInlineError({ message }: Readonly<{ message: string }>) {
  return (
    <div
      className="rounded-md border border-red-500/30 bg-red-500/10 p-4"
      role="alert"
    >
      <p className="text-sm font-medium text-red-200">Unable to load admin data</p>
      <p className="mt-1 text-sm text-red-100/80">{message}</p>
    </div>
  );
}

export function AdminTableScroll({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="marekto-scrollbar overflow-x-auto">
      <table className="w-full min-w-full text-left text-sm">{children}</table>
    </div>
  );
}

/**
 * Server-rendered GET search form. Submitting navigates with the `search` query
 * param, which the page reads from `searchParams` — no client JavaScript needed.
 */
export function AdminSearchForm({
  action,
  defaultValue,
  placeholder,
  label,
}: Readonly<{
  action: string;
  defaultValue: string;
  placeholder: string;
  label: string;
}>) {
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 sm:flex-row sm:items-end"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <label
          className="text-xs font-medium uppercase tracking-wide text-zinc-500"
          htmlFor="admin-search"
        >
          {label}
        </label>
        <input
          className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          defaultValue={defaultValue}
          id="admin-search"
          name="search"
          placeholder={placeholder}
          type="search"
        />
      </div>
      <div className="flex gap-2">
        <button
          className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          type="submit"
        >
          Search
        </button>
        {defaultValue ? (
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href={action}
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export function AdminPagination({
  basePath,
  page,
  pageSize,
  total,
  search,
}: Readonly<{
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  search: string;
}>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const buildHref = (targetPage: number): string => {
    const params = new URLSearchParams();
    if (search) {
      params.set("search", search);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-xs text-zinc-500">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href={buildHref(page - 1)}
          >
            Previous
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-800 px-3 text-sm font-medium text-zinc-600">
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href={buildHref(page + 1)}
          >
            Next
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-800 px-3 text-sm font-medium text-zinc-600">
            Next
          </span>
        )}
      </div>
    </div>
  );
}
