import type { ErrorEnvelope } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: ErrorEnvelope["error"]["details"];

  constructor(
    status: number,
    message: string,
    details: ErrorEnvelope["error"]["details"] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    "details" in error &&
    Array.isArray(error.details),
  );
}

export async function getJson<T>(
  path: string,
  signal: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(
      0,
      "Unable to reach the catalog. Check your connection and try again.",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "The catalog returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      isErrorEnvelope(payload)
        ? payload.error.message
        : "The catalog request failed. Please try again.",
      isErrorEnvelope(payload) ? payload.error.details : [],
    );
  }
  return payload as T;
}
