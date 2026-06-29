const WORKSPACE_HEADER_NAME = "x-workspace-id";

export function getWorkspaceIdFromHeaders(headers: Headers): number {
  const headerValue = headers.get(WORKSPACE_HEADER_NAME);

  if (!headerValue) {
    throw new Error("Missing workspace context");
  }

  const workspaceId = Number(headerValue);

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Invalid workspace id");
  }

  return workspaceId;
}
