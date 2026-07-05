"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

type AuthMode = "login" | "register" | "admin-login";

type AuthFormProps = {
  mode: AuthMode;
};

type AuthSuccessResponse = {
  success: true;
  data: AuthenticatedData | RegistrationVerificationData;
};

type AuthErrorResponse = {
  success: false;
  error: string;
};

type AuthResponse = AuthSuccessResponse | AuthErrorResponse;

type AuthenticatedData = {
  token: string;
  userId: number;
  workspaceId: number;
};

type RegistrationVerificationData = {
  verificationRequired: true;
  email: string;
  expiresInSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthenticatedData(value: unknown): value is AuthenticatedData {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.userId === "number" &&
    typeof value.workspaceId === "number"
  );
}

function isRegistrationVerificationData(
  value: unknown,
): value is RegistrationVerificationData {
  return (
    isRecord(value) &&
    value.verificationRequired === true &&
    typeof value.email === "string" &&
    typeof value.expiresInSeconds === "number"
  );
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    return false;
  }

  if (value.success === false) {
    return typeof value.error === "string";
  }

  if (!isRecord(value.data)) {
    return false;
  }

  return isAuthenticatedData(value.data) || isRegistrationVerificationData(value.data);
}

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const body: unknown = await response.json().catch(() => null);

  if (isAuthResponse(body)) {
    return body;
  }

  return {
    success: false,
    error: response.ok
      ? "Authentication completed, but the response could not be read."
      : "Authentication failed. Please try again.",
  };
}

export function AuthForm({ mode }: Readonly<AuthFormProps>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [pendingRegistrationEmail, setPendingRegistrationEmail] = useState<
    string | null
  >(null);
  const [pendingRegistrationExpiresInSeconds, setPendingRegistrationExpiresInSeconds] =
    useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = ((y - centerY) / centerY) * -5;
      const rotateY = ((x - centerX) / centerX) * 5;
      
      card.style.transition = "none";
      card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    };

    const handleMouseLeave = () => {
      card.style.transition = "transform 0.5s ease-out";
      card.style.transform = `perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
    };

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  const isAdminLogin = mode === "admin-login";
  const isRegister = mode === "register";
  const isVerifyingRegistration = isRegister && pendingRegistrationEmail !== null;
  const title = isVerifyingRegistration
    ? "Verify your email"
    : isRegister
      ? "Create your workspace"
      : isAdminLogin
        ? "Admin sign in"
      : "Sign in to Marekto";
  const description = isRegister
    ? isVerifyingRegistration
      ? "Enter the 6-digit code sent to your email to finish creating the account."
      : "Start with a real tenant workspace and owner account."
    : isAdminLogin
      ? "Use an administrator account to access the admin console."
    : "Use your existing account to load live tenant data.";
  const submitLabel = isVerifyingRegistration
    ? "Verify and create account"
    : isRegister
      ? "Send verification code"
      : isAdminLogin
        ? "Sign in as admin"
      : "Sign in";
  const pendingLabel = isVerifyingRegistration
    ? "Verifying code..."
    : isRegister
      ? "Sending code..."
      : isAdminLogin
        ? "Signing in to admin..."
      : "Signing in...";
  const feedbackId = `${mode}-auth-feedback`;
  const verificationExpiryMinutes =
    pendingRegistrationExpiresInSeconds === null
      ? null
      : Math.max(1, Math.round(pendingRegistrationExpiresInSeconds / 60));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = (
      pendingRegistrationEmail ?? readFormText(formData, "email")
    ).trim().toLowerCase();
    const password = readFormText(formData, "password");
    const confirmPassword = isRegister && !isVerifyingRegistration ? readFormText(formData, "confirmPassword") : null;
    const workspaceName = readFormText(formData, "workspaceName").trim();
    const otp = readFormText(formData, "otp").trim();

    if (isRegister && !isVerifyingRegistration && password !== confirmPassword) {
      setError("Passwords do not match.");
      setIsSubmitting(false);
      return;
    }

    const payload = isVerifyingRegistration
      ? { email, otp }
      : isRegister
        ? { email, password, workspaceName: workspaceName || undefined }
        : { email, password };
    const endpoint = isVerifyingRegistration
      ? "/api/auth/register/verify"
      : isRegister
        ? "/api/auth/register"
        : isAdminLogin
          ? "/api/admin/auth/login"
        : "/api/auth/login";

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const result = await readAuthResponse(response);

      if (!result.success) {
        setError(result.error);
        return;
      }

      if (isRegistrationVerificationData(result.data)) {
        setPendingRegistrationEmail(result.data.email);
        setPendingRegistrationExpiresInSeconds(result.data.expiresInSeconds);
        setNotice(
          `We sent a verification code to ${result.data.email}. It expires in ${Math.round(
            result.data.expiresInSeconds / 60,
          )} minutes.`,
        );
        return;
      }

      setIsRedirecting(true);
      router.push(isAdminLogin ? "/admin" : "/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || isRedirecting;

  return (
    <section 
      ref={cardRef}
      className="relative overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl transition-transform duration-500 ease-out sm:p-10"
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className="relative z-10" style={{ transform: "translateZ(30px)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          {isAdminLogin ? "Admin access" : "Tenant access"}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{description}</p>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {isVerifyingRegistration ? (
          <div className="space-y-4 rounded-md border border-indigo-500/40 bg-zinc-950 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-indigo-400/40 bg-indigo-500/15 text-sm font-semibold text-indigo-100"
              >
                02
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100">
                  Check your inbox
                </p>
                <p className="mt-1 break-words text-sm leading-6 text-zinc-400">
                  The code was sent to{" "}
                  <span className="font-medium text-indigo-200">
                    {pendingRegistrationEmail}
                  </span>
                  .
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Expires in
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">
                  {verificationExpiryMinutes ?? 10} minutes
                </p>
              </div>
              <button
                className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-left text-sm font-semibold text-indigo-200 outline-none transition-colors hover:border-indigo-500/50 hover:text-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:text-zinc-500"
                disabled={isBusy}
                onClick={() => {
                  setPendingRegistrationEmail(null);
                  setPendingRegistrationExpiresInSeconds(null);
                  setNotice(null);
                  setError(null);
                }}
                type="button"
              >
                Use another email
                <span className="mt-1 block text-xs font-normal text-zinc-500">
                  Restart signup with a different address.
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <label className="text-sm font-medium text-zinc-300" htmlFor={`${mode}-email`}>
              Email
            </label>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 text-sm text-zinc-50 outline-none transition-all placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-950 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50"
              disabled={isBusy}
              id={`${mode}-email`}
              name="email"
              placeholder="Email address"
              required
              type="email"
            />
          </div>
        )}

        {isRegister && !isVerifyingRegistration ? (
          <div className="space-y-2.5">
            <label
              className="text-sm font-medium text-zinc-300"
              htmlFor={`${mode}-workspaceName`}
            >
              Workspace name
            </label>
            <input
              autoComplete="organization"
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 text-sm text-zinc-50 outline-none transition-all placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-950 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50"
              disabled={isBusy}
              id={`${mode}-workspaceName`}
              name="workspaceName"
              placeholder="Workspace name"
              type="text"
            />
            <p className="text-xs text-zinc-500">
              Leave blank to let the backend assign a workspace label.
            </p>
          </div>
        ) : null}

        {isVerifyingRegistration ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor={`${mode}-otp`}>
              Verification code
            </label>
            <input
              aria-describedby={notice ? feedbackId : undefined}
              autoComplete="one-time-code"
              className="h-14 w-full rounded-md border border-zinc-800 bg-zinc-950 px-4 text-center font-mono text-2xl font-semibold tracking-widest text-zinc-50 outline-none transition-colors placeholder:text-zinc-700 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500"
              disabled={isBusy}
              id={`${mode}-otp`}
              inputMode="numeric"
              maxLength={6}
              name="otp"
              pattern="[0-9]{6}"
              placeholder="000000"
              required
              type="text"
            />
            <p className="text-xs leading-5 text-zinc-500">
              Paste or type the 6-digit code from the Marekto email.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <label className="text-sm font-medium text-zinc-300" htmlFor={`${mode}-password`}>
                Password
              </label>
              <div className="relative">
                <input
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 pl-4 pr-10 text-sm text-zinc-50 outline-none transition-all placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-950 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50"
                  disabled={isBusy}
                  id={`${mode}-password`}
                  name="password"
                  placeholder="Password"
                  required
                  type={showPassword ? "text" : "password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-none focus-visible:text-indigo-400"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {isRegister && !isVerifyingRegistration ? (
              <div className="space-y-2.5">
                <label className="text-sm font-medium text-zinc-300" htmlFor="confirmPassword">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    autoComplete="new-password"
                    className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 pl-4 pr-10 text-sm text-zinc-50 outline-none transition-all placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-950 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50"
                    disabled={isBusy}
                    id="confirmPassword"
                    name="confirmPassword"
                    placeholder="Confirm Password"
                    required
                    type={showPassword ? "text" : "password"}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}

        {error ? (
          <div
            aria-live="polite"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"
            id={feedbackId}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {notice ? (
          <div
            aria-live="polite"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm leading-6 text-emerald-100"
            id={feedbackId}
          >
            {notice}
          </div>
        ) : null}

        {isRedirecting ? (
          <div
            aria-live="polite"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
            id={feedbackId}
          >
            Authentication succeeded. Redirecting to dashboard...
          </div>
        ) : null}

        <button
          aria-describedby={error || notice || isRedirecting ? feedbackId : undefined}
          className="group relative mt-2 flex h-11 w-full items-center justify-center overflow-hidden rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-[0_0_20px_rgba(79,70,229,0.2)] outline-none transition-all hover:bg-indigo-500 hover:shadow-[0_0_25px_rgba(79,70,229,0.4)] focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50"
          disabled={isBusy}
          type="submit"
        >
          <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-150%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(150%)]">
            <div className="relative h-full w-8 bg-white/20" />
          </div>
          <span className="relative z-10">{isBusy ? pendingLabel : submitLabel}</span>
        </button>
      </form>

      <div className="mt-6 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
        {isRegister ? (
          <p>
            Already have an account?{" "}
            <Link
              className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/login"
            >
              Sign in
            </Link>
          </p>
        ) : isAdminLogin ? (
          <p>
            Need workspace access?{" "}
            <Link
              className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/login"
            >
              Sign in as user
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            <p>
              Need a workspace?{" "}
              <Link
                className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/register"
              >
                Create an account
              </Link>
            </p>
            <p>
              Administrator?{" "}
              <Link
                className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/admin/login"
              >
                Use admin login
              </Link>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
