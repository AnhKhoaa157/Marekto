import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type AuthTokenPayload, verifyJWT } from "@/lib/auth";

const AUTH_COOKIE_NAME = "auth_token";

export async function getServerAuthSession(): Promise<AuthTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  return token ? verifyJWT(token) : null;
}

export async function requireServerAuthSession(): Promise<AuthTokenPayload> {
  const session = await getServerAuthSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
