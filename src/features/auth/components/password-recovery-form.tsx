"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

type Stage = "request" | "reset" | "complete";

type ApiResponse = {
  success: boolean;
  error?: string;
  data?: { developmentOtp?: string };
};

export function PasswordRecoveryForm() {
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const result = (await response.json().catch(() => null)) as ApiResponse | null;

      if (!response.ok || !result?.success) {
        setError(result?.error ?? "Could not request a reset code.");
        return;
      }

      setEmail(normalizedEmail);
      setStage("reset");
      setNotice(
        result.data?.developmentOtp
          ? `Local development code: ${result.data.developmentOtp}`
          : "If an account exists for this email, a reset code has been sent.",
      );
    } catch {
      setError("Could not reach the authentication service.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const otp = String(formData.get("otp") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, password }),
      });
      const result = (await response.json().catch(() => null)) as ApiResponse | null;

      if (!response.ok || !result?.success) {
        setError(result?.error ?? "Could not reset the password.");
        return;
      }

      setStage("complete");
      setNotice(null);
    } catch {
      setError("Could not reach the authentication service.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "complete") {
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-zinc-950/90 p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
          Password updated
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white">Your account is ready</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-300">
          Every previous session has been signed out. Use your new password to
          continue.
        </p>
        <Link
          className="mt-6 flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500"
          href="/login"
        >
          Return to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-8 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
        Account recovery
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white">
        {stage === "request" ? "Forgot your password?" : "Choose a new password"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {stage === "request"
          ? "Enter your account email and we will send a 6-digit reset code."
          : `Enter the code sent for ${email}.`}
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={stage === "request" ? requestCode : resetPassword}
      >
        {stage === "request" ? (
          <label className="block space-y-2 text-sm font-medium text-zinc-300">
            Email
            <input
              autoComplete="email"
              className="h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
        ) : (
          <>
            <label className="block space-y-2 text-sm font-medium text-zinc-300">
              Reset code
              <input
                autoComplete="one-time-code"
                className="h-12 w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 text-center font-mono text-xl tracking-widest text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                disabled={submitting}
                inputMode="numeric"
                maxLength={6}
                name="otp"
                pattern="[0-9]{6}"
                placeholder="000000"
                required
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-zinc-300">
              New password
              <input
                autoComplete="new-password"
                className="h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                disabled={submitting}
                minLength={6}
                name="password"
                required
                type="password"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-zinc-300">
              Confirm new password
              <input
                autoComplete="new-password"
                className="h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                disabled={submitting}
                minLength={6}
                name="confirmPassword"
                required
                type="password"
              />
            </label>
          </>
        )}

        {error ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            {notice}
          </p>
        ) : null}

        <button
          className="flex h-11 w-full items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          disabled={submitting}
          type="submit"
        >
          {submitting
            ? "Please wait..."
            : stage === "request"
              ? "Send reset code"
              : "Reset password"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4 text-sm">
        <Link className="text-indigo-300 hover:text-indigo-200" href="/login">
          Back to sign in
        </Link>
        {stage === "reset" ? (
          <button
            className="text-zinc-400 hover:text-zinc-200"
            onClick={() => {
              setStage("request");
              setError(null);
              setNotice(null);
            }}
            type="button"
          >
            Use another email
          </button>
        ) : null}
      </div>
    </section>
  );
}
