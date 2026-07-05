import { parseUuid } from "./identifiers.ts";

const WORKSPACE_HEADER_NAME = "x-workspace-id";

export function getWorkspaceIdFromHeaders(headers: Headers): string {
  const headerValue = headers.get(WORKSPACE_HEADER_NAME);

  if (!headerValue) {
    throw new Error("Missing workspace context");
  }

  return parseUuid(headerValue, "Workspace id");
}
