import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deleteJson,
  getJson,
  postJson,
  REQUEST_TIMEOUT_MS,
  withRequestDeadline,
} from "../src/api/client";
import { useRequest } from "../src/api/useRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const timeoutError = { status: 0, code: "request_timeout" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("API request deadlines", () => {
  it("bounds a fetch that never resolves and aborts its signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = getJson("/api/products", new AbortController().signal);
    const result = expect(request).rejects.toMatchObject(timeoutError);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await result;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(ApiError);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "keeps the deadline through a stalled body and consumes its late %s",
    async (settlement) => {
      const fetchResponse = deferred<Response>();
      const body = deferred<unknown>();
      const response = jsonResponse({});
      const readBody = vi.spyOn(response, "json").mockReturnValue(body.promise);
      const fetchMock = vi.fn(() => fetchResponse.promise);
      vi.stubGlobal("fetch", fetchMock);
      const request = getJson("/api/products", new AbortController().signal);
      const result = expect(request).rejects.toMatchObject(timeoutError);

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 100);
      fetchResponse.resolve(response);
      await vi.advanceTimersByTimeAsync(0);
      expect(readBody).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);

      await result;
      expect(vi.getTimerCount()).toBe(0);
      if (settlement === "resolve") body.resolve({ data: ["late result"] });
      else body.reject(new Error("Late body failure"));
      await vi.advanceTimersByTimeAsync(0);
      await expect(request).rejects.toMatchObject(timeoutError);
    },
  );

  it("returns a body completed within the deadline and releases timers and listeners", async () => {
    const body = deferred<unknown>();
    const response = jsonResponse({});
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const request = getJson("/api/products", caller.signal);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    body.resolve({ data: [1] });
    await expect(request).resolves.toEqual({ data: [1] });

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      addListener.mock.calls[0]?.[1],
    );
    caller.abort();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expect(request).resolves.toEqual({ data: [1] });
  });

  it.each(["fetch", "body"] as const)(
    "preserves deliberate caller cancellation during %s",
    async (stage) => {
      const body = deferred<unknown>();
      const response = jsonResponse({});
      vi.spyOn(response, "json").mockReturnValue(body.promise);
      const fetchMock = vi.fn<typeof fetch>(() =>
        stage === "fetch"
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(response),
      );
      vi.stubGlobal("fetch", fetchMock);
      const caller = new AbortController();
      const request = getJson("/api/products", caller.signal);
      const reason = new DOMException("Navigation cancelled", "AbortError");
      const result = expect(request).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);

      caller.abort(reason);
      await result;

      const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(signal.reason).toBe(reason);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not start a fetch for an already cancelled caller", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();
    const reason = new DOMException("Cancelled", "AbortError");
    caller.abort(reason);

    await expect(getJson("/api/products", caller.signal)).rejects.toBe(reason);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["POST", "DELETE"] as const)(
    "classifies a stalled %s as an uncertain timeout without retrying",
    async (method) => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal("fetch", fetchMock);
      const request =
        method === "POST"
          ? postJson("/api/shortlist", { product_id: 1 }, "token")
          : deleteJson("/api/shortlist/1", "token");
      const result = expect(request).rejects.toMatchObject(timeoutError);

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await result;
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        method === "POST" ? "/api/shortlist" : "/api/shortlist/1",
        expect.objectContaining({
          method,
          credentials: "same-origin",
          headers: expect.objectContaining({ "X-CSRF-Token": "token" }),
        }),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "consumes a late fetch %s after timeout without reading an obsolete body",
    async (settlement) => {
      const fetchResponse = deferred<Response>();
      const response = jsonResponse({ data: "obsolete" });
      const readBody = vi.spyOn(response, "json");
      vi.stubGlobal(
        "fetch",
        vi.fn(() => fetchResponse.promise),
      );
      const request = getJson("/api/products", new AbortController().signal);
      const result = expect(request).rejects.toMatchObject(timeoutError);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await result;

      if (settlement === "resolve") fetchResponse.resolve(response);
      else fetchResponse.reject(new Error("Late connection failure"));
      await vi.advanceTimersByTimeAsync(0);

      expect(readBody).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await expect(request).rejects.toMatchObject(timeoutError);
    },
  );

  it("preserves network failures and clears their deadline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));

    await expect(
      getJson("/api/products", new AbortController().signal),
    ).rejects.toMatchObject({ status: 0, code: "request_failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves unreadable response failures and clears their deadline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));

    await expect(
      getJson("/api/products", new AbortController().signal),
    ).rejects.toMatchObject({ status: 200, code: "unreadable_response" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves authoritative HTTP validation and CSRF error envelopes", async () => {
    const details = [{ field: "q", message: "Too long" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "validation_error", message: "Invalid", details } },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "csrf_invalid", message: "Expired", details: [] } },
          403,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getJson("/api/products", new AbortController().signal),
    ).rejects.toMatchObject({ status: 400, code: "validation_error", details });
    await expect(
      postJson("/api/shortlist", { product_id: 1 }, "token"),
    ).rejects.toMatchObject({ status: 403, code: "csrf_invalid" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts an empty successful DELETE without attempting JSON parsing", async () => {
    const response = new Response(null, { status: 204 });
    const readBody = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      deleteJson("/api/shortlist/1", "token"),
    ).resolves.toBeUndefined();

    expect(readBody).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up a complete-operation deadline after a synchronous failure", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const error = new Error("Lock unavailable");

    await expect(
      withRequestDeadline(() => {
        throw error;
      }, caller.signal),
    ).rejects.toBe(error);

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a stalled complete operation that ignores its abort signal", async () => {
    const request = withRequestDeadline(() => new Promise(() => undefined));
    const result = expect(request).rejects.toMatchObject(timeoutError);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await result;

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useRequest cancellation and deadline state", () => {
  it("shows a timeout as a recoverable error and allows a fresh attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(jsonResponse({ data: "recovered" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ attempt }) => useRequest<{ data: string }>("/api/products", attempt),
      { initialProps: { attempt: 0 } },
    );

    await act(() => vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatchObject(timeoutError);

    await act(async () => {
      rerender({ attempt: 1 });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toEqual({
      data: { data: "recovered" },
      error: null,
      loading: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels navigation requests and ignores their late response", async () => {
    const obsolete = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(obsolete.promise)
      .mockResolvedValueOnce(jsonResponse({ data: "current route" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ path }) => useRequest<{ data: string }>(path),
      { initialProps: { path: "/api/products/old-chair" } },
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;

    await act(async () => {
      rerender({ path: "/api/products/new-chair" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(oldSignal.aborted).toBe(true);
    expect(oldSignal.reason.name).toBe("AbortError");
    expect(result.current.data).toEqual({ data: "current route" });
    expect(result.current.error).toBeNull();

    const lateResponse = jsonResponse({ data: "obsolete route" });
    const readBody = vi.spyOn(lateResponse, "json");
    await act(async () => {
      obsolete.resolve(lateResponse);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readBody).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ data: "current route" });
    expect(result.current.loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
