import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { BackToHomeLink } from "@/components/brand/back-to-home-link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { verifyJWT } from "@/lib/auth";

export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";

export const metadata = {
  title: "Register | Marekto",
  description: "Create a Marekto workspace.",
};

async function redirectAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const payload = token ? await verifyJWT(token) : null;

  if (payload) {
    redirect("/dashboard");
  }
}

export default async function RegisterPage() {
  await redirectAuthenticatedUser();

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 px-4 py-6 text-zinc-50 sm:px-6 lg:px-8">
      <div className="marekto-fade-up mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 py-8 lg:grid lg:grid-cols-2 lg:items-center">
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <Link
              aria-label="Marekto home"
              className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/"
            >
              <BrandLogo className="h-10 w-28" priority sizes="112px" />
            </Link>
            <BackToHomeLink />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Workspace provisioning
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
              Create the first real tenant boundary.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
              Registration calls the backend transaction that creates the
              workspace, owner account, membership, token, and authenticated
              cookie in one flow.
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm font-medium text-zinc-200">
              No sample workspace data
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              After registration, dashboard sections show only records that
              exist in the authenticated workspace.
            </p>
          </div>
        </section>

        <AuthForm mode="register" />
      </div>
    </main>
  );
}
