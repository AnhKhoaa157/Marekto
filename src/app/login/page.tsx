import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/features/auth/components/auth-form";
import { BackToHomeLink } from "@/components/brand/back-to-home-link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Background3D } from "@/components/homepage/background-3d";
import { verifyJWT } from "@/lib/auth";

export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";

export const metadata = {
  title: "Login | Marekto",
  description: "Sign in to Marekto.",
};

async function redirectAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const payload = token ? await verifyJWT(token) : null;

  if (payload) {
    redirect("/dashboard");
  }
}

export default async function LoginPage() {
  await redirectAuthenticatedUser();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden text-zinc-50 sm:px-6 lg:px-8">
      <Background3D />
      {/* Ambient glowing orb behind the form */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-[100px]"
      />

      <div className="marekto-fade-up w-full max-w-[440px]">
        <div className="mb-8 flex flex-col items-center justify-center space-y-4 text-center">
          <Link
            aria-label="Marekto home"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            href="/"
          >
            <BrandLogo className="h-10 w-28" priority sizes="112px" />
          </Link>
          <p className="text-sm text-zinc-400">
            Welcome back to your workspace.
          </p>
        </div>

        <AuthForm mode="login" />

        <div className="mt-8 flex justify-center">
          <BackToHomeLink />
        </div>
      </div>
    </main>
  );
}
