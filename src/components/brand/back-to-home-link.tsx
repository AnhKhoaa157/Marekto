import Link from "next/link";

/**
 * Subtle "Back to homepage" control for the auth pages. Routes to `/`, stays
 * keyboard accessible, and matches the dark SaaS styling without competing with
 * the primary auth action.
 */
export function BackToHomeLink() {
  return (
    <Link
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-zinc-400 outline-none transition-colors hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
      href="/"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      Back to homepage
    </Link>
  );
}
