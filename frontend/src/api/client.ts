import type { ErrorEnvelope } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: ErrorEnvelope["error"]["details"];
  readonly code: string;

  constructor(
    status: number,
    message: string,
    details: ErrorEnvelope["error"]["details"] = [],
    code = "request_failed",
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      "message" in error &&
      typeof error.message === "string" &&
      "details" in error &&
      Array.isArray(error.details),
  );
}

async function requestJson<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    signal?: AbortSignal;
    body?: unknown;
    csrfToken?: string;
  },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal: options.signal,
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      "Unable to reach the catalog. Check your connection and try again.",
    );
  }
  if (response.ok && response.status === 204) return undefined as T;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "The catalog returned an unreadable response. Please try again.",
      [],
      "unreadable_response",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      isErrorEnvelope(payload)
        ? payload.error.message
        : "The catalog request failed. Please try again.",
      isErrorEnvelope(payload) ? payload.error.details : [],
      isErrorEnvelope(payload) ? payload.error.code : "request_failed",
    );
  }
  return payload as T;
}

export function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

export function postJson<T>(
  path: string,
  body: unknown,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<T> {
  return requestJson<T>(path, { method: "POST", body, csrfToken, signal });
}

export function deleteJson(
  path: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<void> {
  return requestJson<void>(path, { method: "DELETE", csrfToken, signal });
}
