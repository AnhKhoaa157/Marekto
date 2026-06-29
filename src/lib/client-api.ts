"use client";

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function requestApi<T>(
  input: string,
  init: RequestInit,
  parseData: (value: unknown) => T,
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
  const body: unknown = await response.json().catch(() => null);

  if (!isRecord(body) || typeof body.success !== "boolean") {
    throw new ApiRequestError("The server returned an invalid response.", response.status);
  }

  if (!body.success) {
    const message =
      typeof body.error === "string" ? body.error : "The request could not be completed.";
    throw new ApiRequestError(message, response.status);
  }

  return parseData(body.data);
}

export function formatApiDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
