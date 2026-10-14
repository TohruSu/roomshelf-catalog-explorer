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

export const REQUEST_TIMEOUT_MS = 10_000;

export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectCancellation!: (reason: unknown) => void;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const cancel = (reason: unknown) => {
    if (controller.signal.aborted) return;
    rejectCancellation(reason);
    controller.abort(reason);
  };
  const onCallerAbort = () => cancel(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(
    () =>
      cancel(
        new ApiError(
          0,
          "The catalog request timed out. Please try again.",
          [],
          "request_timeout",
        ),
      ),
    REQUEST_TIMEOUT_MS,
  );
  if (callerSignal?.aborted) onCallerAbort();
  try {
    let work: Promise<T>;
    try {
      controller.signal.throwIfAborted();
      work = operation(controller.signal);
    } catch (error) {
      work = Promise.reject(error);
    }
    // Abort alone cannot release a stalled operation that ignores its signal.
    return await Promise.race([work, cancellation]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
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
  return withRequestDeadline(async (signal) => {
    let response: Response;
    try {
      response = await fetch(path, {
        signal,
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
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ApiError(
        0,
        "Unable to reach the catalog. Check your connection and try again.",
      );
    }
    signal.throwIfAborted();
    if (response.ok && response.status === 204) return undefined as T;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ApiError(
        response.status,
        "The catalog returned an unreadable response. Please try again.",
        [],
        "unreadable_response",
      );
    }
    signal.throwIfAborted();
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
  }, options.signal);
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
