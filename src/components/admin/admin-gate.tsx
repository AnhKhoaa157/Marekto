import Link from "next/link";

type AdminGateVariant = "unauthenticated" | "forbidden" | "error";

type AdminGateProps = {
  variant: AdminGateVariant;
  message?: string;
};

const GATE_COPY: Record<
  AdminGateVariant,
  {
    eyebrow: string;
    title: string;
    description: string;
    tone: string;
    href: string;
    action: string;
  }
> = {
  unauthenticated: {
    eyebrow: "401 · Authentication required",
    title: "Sign in to continue",
    description:
      "The admin console requires an authenticated session. Sign in with an administrator account to continue.",
    tone: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    href: "/login",
    action: "Go to sign in",
  },
  forbidden: {
    eyebrow: "403 · Administrator access required",
    title: "You do not have admin access",
    description:
      "This area is limited to system administrators. Your account is signed in but is not authorized for the admin console.",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    href: "/dashboard",
    action: "Return to workspace",
  },
  error: {
    eyebrow: "Something went wrong",
    title: "Admin data could not be loaded",
    description:
      "An error interrupted the request. Retry, and if it keeps failing, check the service status.",
    tone: "border-red-500/30 bg-red-500/10 text-red-200",
    href: "/admin",
    action: "Retry",
  },
};

/**
 * Full-screen gate rendered when an admin surface cannot show its content:
 * unauthenticated (401), forbidden (403), or a load error. Intentionally hides
 * the admin navigation so unauthorized users see no admin surface at all.
 */
export function AdminGate({ variant, message }: Readonly<AdminGateProps>) {
  const copy = GATE_COPY[variant];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-50">
      <section
        aria-label={copy.title}
        className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-sm"
        role={variant === "error" ? "alert" : undefined}
      >
        <span
          className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${copy.tone}`}
        >
          {copy.eyebrow}
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-50">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">{message ?? copy.description}</p>
        <Link
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          href={copy.href}
        >
          {copy.action}
        </Link>
      </section>
    </main>
  );
}
