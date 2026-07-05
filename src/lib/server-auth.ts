import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type AuthTokenPayload, verifyJWT } from "@/lib/auth";
import { initializeDatabase, query } from "@/lib/db";

const AUTH_COOKIE_NAME = "auth_token";
const ADMIN_ROLE = "admin";
const SELECT_USER_ROLE_SQL = 'SELECT role FROM "Users" WHERE id = $1';

type UserRoleRow = {
  role: string;
};

export async function getServerAuthSession(): Promise<AuthTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  return token ? verifyJWT(token) : null;
}

async function getSessionUserRole(userId: string): Promise<string | null> {
  await initializeDatabase();

  const result = await query<UserRoleRow>(SELECT_USER_ROLE_SQL, [userId]);
  return result.rows[0]?.role ?? null;
}

export async function getServerUserSession(): Promise<AuthTokenPayload | null> {
  const session = await getServerAuthSession();

  if (!session) {
    return null;
  }

  const role = await getSessionUserRole(session.userId);

  if (!role) {
    return null;
  }

  if (role === ADMIN_ROLE) {
    redirect("/admin");
  }

  return session;
}

export async function requireServerAuthSession(): Promise<AuthTokenPayload> {
  const session = await getServerAuthSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireServerUserSession(): Promise<AuthTokenPayload> {
  const session = await getServerUserSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireServerWorkspaceSession(): Promise<
  AuthTokenPayload & { workspaceId: string }
> {
  const session = await requireServerUserSession();

  if (!session.workspaceId) {
    redirect("/onboarding/workspace");
  }

  return { ...session, workspaceId: session.workspaceId };
}
