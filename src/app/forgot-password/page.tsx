import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Background3D } from "@/components/homepage/background-3d";
import { PasswordRecoveryForm } from "@/features/auth/components/password-recovery-form";

export const metadata = {
  title: "Reset password | Marekto",
  description: "Recover access to your Marekto account.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 text-zinc-50">
      <Background3D />
      <div className="relative z-10 w-full max-w-md">
        <Link
          aria-label="Marekto home"
          className="mx-auto mb-8 flex w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          href="/"
        >
          <BrandLogo className="h-10 w-28" priority sizes="112px" />
        </Link>
        <PasswordRecoveryForm />
      </div>
    </main>
  );
}
