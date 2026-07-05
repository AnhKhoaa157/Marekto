import { isUuid } from "./identifiers.ts";

export type AuthenticatedData = {
  token: string;
  userId: string;
  workspaceId: string | null;
  nextPath?: string;
};

export function isAuthenticatedData(value: unknown): value is AuthenticatedData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    isUuid(candidate.userId) &&
    (isUuid(candidate.workspaceId) || candidate.workspaceId === null) &&
    (candidate.nextPath === undefined || typeof candidate.nextPath === "string")
  );
}
