import { isUuid } from "../../../lib/identifiers.ts";

/**
 * Framework-free data loader for the workspace Members page.
 *
 * Contract:
 *   - The page is server-guarded by `requireServerWorkspaceSession()`, so on a
 *     hard load authentication and workspace context are verified before this
 *     runs. On client-side navigations the session may have rotated or
 *     expired since the page was prefetched, so instead of surfacing raw
 *     token errors the loader classifies 401/403 responses and lets the
 *     component redirect or explain.
 *   - All identifiers are UUID strings and are validated as such; a payload
 *     with non-string ids is treated as an invalid response, never coerced.
 *   - `createMembersPageLoader` coalesces concurrent calls into one in-flight
 *     request batch so a mount can never fire duplicate Members API requests.
 */

export type WorkspaceMember = {
  user_id: string;
  email: string;
  role: "owner" | "member";
  joined_at: string | null;
};

export type WorkspaceInvite = {
  id: string;
  workspace_name: string;
  created_by_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type WorkspaceAuditEvent = {
  id: string;
  actor_email: string | null;
  target_type: string;
  target_id: string | null;
  action: string;
  created_at: string;
};

export type MembersPageData = {
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  events: WorkspaceAuditEvent[];
};

export type MembersPageLoadResult =
  | { kind: "ok"; data: MembersPageData }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

type LoadOptions = {
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseMember(value: unknown): WorkspaceMember {
  if (
    !isRecord(value) ||
    !isUuid(value.user_id) ||
    typeof value.email !== "string" ||
    (value.role !== "owner" && value.role !== "member") ||
    !isNullableString(value.joined_at)
  ) {
    throw new Error("The members response has an invalid shape.");
  }

  return {
    user_id: value.user_id,
    email: value.email,
    role: value.role,
    joined_at: value.joined_at,
  };
}

function parseInvite(value: unknown): WorkspaceInvite {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.workspace_name !== "string" ||
    !isNullableString(value.created_by_email) ||
    typeof value.expires_at !== "string" ||
    !isNullableString(value.revoked_at) ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("The invites response has an invalid shape.");
  }

  return {
    id: value.id,
    workspace_name: value.workspace_name,
    created_by_email: value.created_by_email,
    expires_at: value.expires_at,
    revoked_at: value.revoked_at,
    created_at: value.created_at,
  };
}

function parseAuditEvent(value: unknown): WorkspaceAuditEvent {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isNullableString(value.actor_email) ||
    typeof value.target_type !== "string" ||
    !(value.target_id === null || isUuid(value.target_id)) ||
    typeof value.action !== "string" ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("The activity response has an invalid shape.");
  }

  return {
    id: value.id,
    actor_email: value.actor_email,
    target_type: value.target_type,
    target_id: value.target_id,
    action: value.action,
    created_at: value.created_at,
  };
}

function parseList<T>(value: unknown, key: string, parseItem: (item: unknown) => T): T[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw new Error(`The ${key} response has an invalid shape.`);
  }

  return value[key].map(parseItem);
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }

  return fallback;
}

async function requestSection(
  fetchImpl: typeof fetch,
  path: string,
  options: LoadOptions,
): Promise<
  | { kind: "ok"; data: unknown }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string }
> {
  const response = await fetchImpl(path, {
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);

  if (response.status === 401) {
    return { kind: "unauthorized" };
  }

  if (response.status === 403) {
    return {
      kind: "forbidden",
      message: errorMessage(body, "Workspace owner access is required."),
    };
  }

  if (!response.ok || !isRecord(body) || body.success !== true) {
    return {
      kind: "error",
      message: errorMessage(body, "The request could not be completed."),
    };
  }

  return { kind: "ok", data: body.data };
}

export async function loadMembersPageData(
  fetchImpl: typeof fetch = fetch,
  options: LoadOptions = {},
): Promise<MembersPageLoadResult> {
  try {
    const [members, invites, activity] = await Promise.all([
      requestSection(fetchImpl, "/api/workspace/members", options),
      requestSection(fetchImpl, "/api/workspace/invites", options),
      requestSection(fetchImpl, "/api/workspace/activity", options),
    ]);

    for (const section of [members, invites, activity]) {
      if (section.kind !== "ok") {
        return section;
      }
    }

    if (members.kind !== "ok" || invites.kind !== "ok" || activity.kind !== "ok") {
      return { kind: "error", message: "The request could not be completed." };
    }

    return {
      kind: "ok",
      data: {
        members: parseList(members.data, "members", parseMember),
        invites: parseList(invites.data, "invites", parseInvite),
        events: parseList(activity.data, "events", parseAuditEvent),
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return {
      kind: "error",
      message:
        error instanceof Error ? error.message : "Unable to load workspace members.",
    };
  }
}

export type MembersPageLoader = (options?: LoadOptions) => Promise<MembersPageLoadResult>;

/**
 * Wrap `loadMembersPageData` with a single-flight guard: while one load is in
 * flight, further calls join it instead of issuing duplicate Members API
 * requests. A new load starts only after the previous one settles.
 */
export function createMembersPageLoader(
  fetchImpl: typeof fetch = fetch,
): MembersPageLoader {
  let inFlight: Promise<MembersPageLoadResult> | null = null;

  return function load(options: LoadOptions = {}): Promise<MembersPageLoadResult> {
    if (!inFlight) {
      inFlight = loadMembersPageData(fetchImpl, options).finally(() => {
        inFlight = null;
      });
    }

    return inFlight;
  };
}
