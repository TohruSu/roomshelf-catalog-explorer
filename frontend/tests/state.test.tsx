import { StrictMode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as client from "../src/api/client";
import type { Product, Session, ShortlistItem } from "../src/api/types";
import { CompareProvider, useCompare } from "../src/state/CompareProvider";
import {
  ShortlistProvider,
  useShortlist,
} from "../src/state/ShortlistProvider";

const products: Product[] = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  slug: `cove-chair-00${index + 1}`,
  title: `Cove Chair ${index + 1}`,
  category: "chair",
  material: "wood",
  color: "natural",
  price_jpy: 19800,
  dimensions_cm: { width: 52, depth: 54, height: 80 },
  availability: "in_stock",
  illustration_key: "chair-01",
}));
const first = products[0]!;
const second = products[1]!;
const session: Session = {
  session_ref: "browser-a",
  csrf_token: "csrf-a",
  csrf_expires_at: "2026-10-14T01:00:00.000000Z",
  session_expires_at: "2026-11-13T00:00:00.000000Z",
};
const item = (product: Product): ShortlistItem => ({
  product,
  added_at: "2026-10-14T00:00:00.000000Z",
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const failure = (status: number, code: string, message = code) =>
  json({ error: { code, message, details: [] } }, status);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Handler = (
  path: string,
  init: RequestInit,
) => Response | Promise<Response> | undefined;
function server(handler: Handler = () => undefined) {
  const saved = new Map<number, ShortlistItem>();
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      const overridden = handler(path, init);
      if (overridden !== undefined) return overridden;
      if (path === "/api/session") return json({ data: session });
      if (path === "/api/shortlist")
        return json({ data: [...saved.values()], meta: { total: saved.size } });
      if (path === "/api/shortlist/items") {
        const { product_id: id } = JSON.parse(String(init.body)) as {
          product_id: number;
        };
        saved.set(id, item(products.find((product) => product.id === id)!));
        return json({ data: { product_id: id, saved: true } });
      }
      if (path.startsWith("/api/shortlist/items/")) {
        saved.delete(Number(path.split("/").at(-1)));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetch);
  const calls = (path: string) =>
    fetch.mock.calls.filter(([input]) => input === path);
  return { saved, fetch, calls };
}

function setupShortlist(strict = false) {
  let state!: ReturnType<typeof useShortlist>;
  function Probe() {
    state = useShortlist();
    return (
      <output>
        {state.status}:{state.items.map(({ product }) => product.id).join(",")}
      </output>
    );
  }
  const tree = (
    <ShortlistProvider>
      <Probe />
    </ShortlistProvider>
  );
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, state: () => state };
}

async function ready(view: ReturnType<typeof setupShortlist>) {
  await waitFor(() => expect(view.state().status).toBe("ready"));
}

describe("shortlist session and read state", () => {
  it("uses the origin-scoped bootstrap lock without browser storage", async () => {
    const request = vi.fn(async (_name: string, run: () => Promise<Session>) =>
      run(),
    );
    const setLocal = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("navigator", { locks: { request } });
    const api = server();
    const view = setupShortlist();
    await ready(view);
    expect(request).toHaveBeenCalledWith(
      "roomshelf-session-bootstrap",
      expect.any(Function),
    );
    expect(api.calls("/api/session")).toHaveLength(1);
    await act(async () => view.state().save(first));
    expect(request).toHaveBeenCalledTimes(1);
    expect(setLocal).not.toHaveBeenCalled();
  });

  it.each(["absent", "denied"])(
    "bootstraps and preserves safe mutation behavior when locks are %s",
    async (availability) => {
      const request = vi
        .fn()
        .mockRejectedValue(
          new DOMException("Locks unavailable", "SecurityError"),
        );
      vi.stubGlobal(
        "navigator",
        availability === "absent" ? {} : { locks: { request } },
      );
      const api = server();
      const view = setupShortlist();
      await ready(view);
      expect(api.calls("/api/session")).toHaveLength(1);
      await act(async () => view.state().save(first));
      expect(view.state().isSaved(first.id)).toBe(true);
      expect(request).toHaveBeenCalledTimes(availability === "absent" ? 0 : 1);
    },
  );

  it("surfaces a failed request inside an acquired lock without an automatic fallback retry", async () => {
    const request = vi.fn(async (_name: string, run: () => Promise<Session>) =>
      run(),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const api = server((path) =>
      path === "/api/session" ? failure(503, "database_busy") : undefined,
    );
    const view = setupShortlist();
    await waitFor(() => expect(view.state().status).toBe("error"));
    expect(api.calls("/api/session")).toHaveLength(1);
    expect(view.state().error).toBe("database_busy");
  });

  it("shares first-session creation through StrictMode cleanup without aborting the cookie request", async () => {
    const bootstrap = deferred<Response>();
    const api = server((path) =>
      path === "/api/session" ? bootstrap.promise : undefined,
    );
    const view = setupShortlist(true);
    expect(api.calls("/api/session")).toHaveLength(1);
    const signal = api.calls("/api/session")[0]![1]?.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => bootstrap.resolve(json({ data: session })));
    await ready(view);
    expect(api.calls("/api/shortlist")).toHaveLength(1);
    expect(view.state().ids.size).toBe(0);
  });

  it("retries a failed initial session without reading or enabling writes first", async () => {
    let failing = true;
    const api = server((path) =>
      path === "/api/session" && failing
        ? failure(503, "database_unavailable")
        : undefined,
    );
    const view = setupShortlist();
    await waitFor(() => expect(view.state().status).toBe("error"));
    expect(view.state().error).toBe("database_unavailable");
    await act(async () => view.state().save(first));
    expect(api.calls("/api/shortlist")).toHaveLength(0);
    expect(api.calls("/api/shortlist/items")).toHaveLength(0);
    failing = false;
    act(() => view.state().retry());
    await ready(view);
    expect(api.calls("/api/session")).toHaveLength(2);
    expect(view.state().error).toBeNull();
  });

  it("hides stale membership after a failed read and recovers using a fresh read", async () => {
    let failing = false;
    const api = server((path) =>
      path === "/api/shortlist" && failing
        ? failure(503, "database_busy")
        : undefined,
    );
    api.saved.set(first.id, item(first));
    const view = setupShortlist();
    await ready(view);
    expect(view.state().isSaved(first.id)).toBe(true);
    failing = true;
    act(() => view.state().retry());
    await waitFor(() => expect(view.state().status).toBe("error"));
    expect(view.state().ids.size).toBe(0);
    expect(view.state().items).toEqual([]);
    failing = false;
    act(() => view.state().retry());
    await ready(view);
    expect(view.state().isSaved(first.id)).toBe(true);
    expect(view.state().error).toBeNull();
  });

  it.each(["success", "failure"])(
    "ignores an obsolete read %s even when the transport ignores abort",
    async (outcome) => {
      const oldRead = deferred<Response>();
      let readCount = 0;
      const api = server((path) =>
        path === "/api/shortlist" && ++readCount === 1
          ? oldRead.promise
          : undefined,
      );
      api.saved.set(second.id, item(second));
      const view = setupShortlist();
      await waitFor(() => expect(api.calls("/api/shortlist")).toHaveLength(1));
      act(() => view.state().retry());
      await ready(view);
      expect(api.calls("/api/shortlist")[0]![1]?.signal?.aborted).toBe(true);
      await act(async () => {
        if (outcome === "success")
          oldRead.resolve(json({ data: [item(first)], meta: { total: 1 } }));
        else oldRead.reject(new TypeError("Old request failed"));
      });
      expect([...view.state().ids]).toEqual([second.id]);
      expect(view.state().status).toBe("ready");
      expect(view.state().error).toBeNull();
    },
  );

  it("ignores a read rejection when a retry starts between the inner and outer catch continuations", async () => {
    const api = server();
    api.saved.set(second.id, item(second));
    const original = client.getJson;
    let firstRead = true;
    vi.spyOn(client, "getJson").mockImplementation(
      <T,>(path: string, signal: AbortSignal): Promise<T> => {
        if (path !== "/api/shortlist" || !firstRead)
          return original<T>(path, signal);
        firstRead = false;
        // Resolving await's rejection continuation before scheduling the retry
        // puts that retry after readItems' catch and before load's outer catch.
        return {
          then: (_resolve: unknown, reject: (reason: unknown) => void) => {
            reject(new Error("Obsolete read failure"));
            queueMicrotask(() => view.state().retry());
          },
        } as unknown as Promise<T>;
      },
    );
    const view = setupShortlist();
    await ready(view);
    expect([...view.state().ids]).toEqual([second.id]);
    expect(view.state().error).toBeNull();
  });

  it("ignores session completion after unmount and lets a later provider bootstrap independently", async () => {
    const bootstrap = deferred<Response>();
    let firstRequest = true;
    const api = server((path) => {
      if (path === "/api/session" && firstRequest) {
        firstRequest = false;
        return bootstrap.promise;
      }
    });
    const view = setupShortlist();
    view.unmount();
    await act(async () => bootstrap.resolve(json({ data: session })));
    expect(api.calls("/api/shortlist")).toHaveLength(0);
    const later = setupShortlist();
    await ready(later);
    expect(api.calls("/api/session")).toHaveLength(2);
  });
});

describe("shortlist mutation state", () => {
  it("sends same-origin requests with only the CSRF header and validated item body, then derives membership from the server", async () => {
    const api = server();
    const view = setupShortlist();
    await ready(view);
    await act(async () => view.state().save(first));
    expect(api.calls("/api/shortlist/items")[0]![1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": session.csrf_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ product_id: first.id }),
    });
    expect(view.state().isSaved(first.id)).toBe(true);
    await act(async () => view.state().remove(first.id));
    expect(api.calls(`/api/shortlist/items/${first.id}`)[0]![1]).toMatchObject({
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": session.csrf_token },
    });
    expect(view.state().isSaved(first.id)).toBe(false);
    expect(view.state().pendingIds.size).toBe(0);
  });

  it("serializes different product writes and suppresses duplicate pending actions", async () => {
    const firstWrite = deferred<Response>();
    let firstPost = true;
    const api = server((path) => {
      if (path === "/api/shortlist/items" && firstPost) {
        firstPost = false;
        return firstWrite.promise;
      }
    });
    const view = setupShortlist();
    await ready(view);
    let firstAction!: Promise<void>;
    let secondAction!: Promise<void>;
    act(() => {
      firstAction = view.state().save(first);
      void view.state().toggle(first);
      secondAction = view.state().save(second);
    });
    await waitFor(() =>
      expect(api.calls("/api/shortlist/items")).toHaveLength(1),
    );
    expect([...view.state().pendingIds]).toEqual([first.id, second.id]);
    expect(view.state().ids.size).toBe(0);
    api.saved.set(first.id, item(first));
    await act(async () => {
      firstWrite.resolve(json({ data: { product_id: first.id, saved: true } }));
      await Promise.all([firstAction, secondAction]);
    });
    expect(api.calls("/api/shortlist/items")).toHaveLength(2);
    expect(api.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/session",
      "/api/shortlist",
      "/api/shortlist/items",
      "/api/shortlist",
      "/api/shortlist/items",
      "/api/shortlist",
    ]);
    expect([...view.state().ids]).toEqual([first.id, second.id]);
    expect(view.state().pendingIds.size).toBe(0);
  });

  it("refreshes an invalid CSRF token and retries once only for the same session reference", async () => {
    let sessions = 0;
    let posts = 0;
    const fresh = { ...session, csrf_token: "csrf-fresh" };
    const api = server((path) => {
      if (path === "/api/session")
        return json({ data: ++sessions === 1 ? session : fresh });
      if (path === "/api/shortlist/items" && ++posts === 1)
        return failure(403, "csrf_invalid");
    });
    const view = setupShortlist();
    await ready(view);
    await act(async () => view.state().save(first));
    expect(api.calls("/api/session")).toHaveLength(2);
    expect(
      api
        .calls("/api/shortlist/items")
        .map(([, init]) => new Headers(init?.headers).get("X-CSRF-Token")),
    ).toEqual(["csrf-a", "csrf-fresh"]);
    expect(view.state().isSaved(first.id)).toBe(true);
    expect(view.state().error).toBeNull();
  });

  it("stops after the second CSRF rejection without another bootstrap or mutation", async () => {
    const api = server((path) =>
      path === "/api/shortlist/items"
        ? failure(403, "csrf_invalid", "Token expired again.")
        : undefined,
    );
    const view = setupShortlist();
    await ready(view);
    await act(async () => view.state().save(first));
    expect(api.calls("/api/session")).toHaveLength(2);
    expect(api.calls("/api/shortlist/items")).toHaveLength(2);
    expect(api.calls("/api/shortlist")).toHaveLength(1);
    expect(view.state().error).toBe("Token expired again.");
    expect(view.state().ids.size).toBe(0);
  });

  it.each([401, 403])(
    "renews an expired/replaced session after %s without replaying the mutation or its queued actions",
    async (status) => {
      let sessions = 0;
      const replacement = {
        ...session,
        session_ref: "browser-b",
        csrf_token: "csrf-b",
      };
      const rejected = deferred<Response>();
      const api = server((path) => {
        if (path === "/api/session")
          return json({ data: ++sessions === 1 ? session : replacement });
        if (path === "/api/shortlist/items") return rejected.promise;
      });
      const view = setupShortlist();
      await ready(view);
      let action!: Promise<void>;
      let queued!: Promise<void>;
      act(() => {
        action = view.state().save(first);
        queued = view.state().save(second);
      });
      await waitFor(() =>
        expect(api.calls("/api/shortlist/items")).toHaveLength(1),
      );
      await act(async () => {
        rejected.resolve(
          failure(status, status === 401 ? "session_required" : "csrf_invalid"),
        );
        await Promise.all([action, queued]);
      });
      expect(api.calls("/api/session")).toHaveLength(2);
      expect(api.calls("/api/shortlist/items")).toHaveLength(1);
      expect(api.calls("/api/shortlist")).toHaveLength(2);
      expect(view.state().status).toBe("ready");
      expect(view.state().ids.size).toBe(0);
      expect(view.state().error).toMatch(/changed|ended/);
      expect(view.state().pendingIds.size).toBe(0);
    },
  );

  it.each(["offline", "server", "unreadable"])(
    "reconciles an ambiguous %s result without replaying a possibly committed mutation",
    async (outcome) => {
      const api = server((path) => {
        if (path !== "/api/shortlist/items") return;
        api.saved.set(first.id, item(first));
        if (outcome === "offline")
          return Promise.reject(new TypeError("Response lost"));
        if (outcome === "server") return failure(503, "database_unavailable");
        return json({ data: { product_id: second.id, saved: true } });
      });
      const view = setupShortlist();
      await ready(view);
      await act(async () => view.state().save(first));
      expect(api.calls("/api/shortlist/items")).toHaveLength(1);
      expect(api.calls("/api/session")).toHaveLength(2);
      expect(api.calls("/api/shortlist")).toHaveLength(2);
      expect(view.state().isSaved(first.id)).toBe(true);
      expect(view.state().error).toContain("could not be confirmed");
      expect(view.state().status).toBe("ready");
    },
  );

  it("reports definitive validation/origin errors without refreshing or retrying", async () => {
    const api = server((path) =>
      path === "/api/shortlist/items"
        ? failure(403, "origin_forbidden", "Request origin is not allowed.")
        : undefined,
    );
    const view = setupShortlist();
    await ready(view);
    await act(async () => view.state().save(first));
    expect(api.calls("/api/session")).toHaveLength(1);
    expect(api.calls("/api/shortlist/items")).toHaveLength(1);
    expect(api.calls("/api/shortlist")).toHaveLength(1);
    expect(view.state().error).toBe("Request origin is not allowed.");
  });

  it("disables membership after failed reconciliation and cancels waiting actions until an explicit retry", async () => {
    let reads = 0;
    let failing = true;
    const api = server((path) => {
      if (path === "/api/shortlist/items" && failing)
        return failure(503, "database_busy");
      if (path === "/api/shortlist" && ++reads > 1 && failing)
        return failure(503, "database_busy");
    });
    const view = setupShortlist();
    await ready(view);
    let action!: Promise<void>;
    let queued!: Promise<void>;
    act(() => {
      action = view.state().save(first);
      queued = view.state().save(second);
    });
    await act(async () => Promise.all([action, queued]));
    expect(view.state().status).toBe("error");
    expect(view.state().ids.size).toBe(0);
    expect(api.calls("/api/shortlist/items")).toHaveLength(1);
    failing = false;
    act(() => view.state().retry());
    await ready(view);
    expect(view.state().error).toBeNull();
    await act(async () => view.state().save(second));
    expect(view.state().isSaved(second.id)).toBe(true);
  });

  it("does not send queued actions after provider unmount or read an in-flight write result", async () => {
    const pending = deferred<Response>();
    const api = server((path) =>
      path === "/api/shortlist/items" ? pending.promise : undefined,
    );
    const view = setupShortlist();
    await ready(view);
    let action!: Promise<void>;
    let queued!: Promise<void>;
    act(() => {
      action = view.state().save(first);
      queued = view.state().save(second);
    });
    await waitFor(() =>
      expect(api.calls("/api/shortlist/items")).toHaveLength(1),
    );
    view.unmount();
    await act(async () => {
      pending.resolve(json({ data: { product_id: first.id, saved: true } }));
      await Promise.all([action, queued]);
    });
    expect(api.calls("/api/shortlist/items")).toHaveLength(1);
    expect(api.calls("/api/shortlist")).toHaveLength(1);
  });
});

describe("in-memory comparison state", () => {
  function setupCompare() {
    let state!: ReturnType<typeof useCompare>;
    function Probe() {
      state = useCompare();
      return <output>{state.products.length}</output>;
    }
    return {
      ...render(
        <CompareProvider>
          <Probe />
        </CompareProvider>,
      ),
      state: () => state,
    };
  }

  it("deduplicates selections and enforces the three-product cap even in a single event", () => {
    const view = setupCompare();
    act(() => {
      expect(view.state().add(first)).toBe(true);
      expect(view.state().add(first)).toBe(true);
      expect(view.state().add(second)).toBe(true);
      expect(view.state().add(products[2]!)).toBe(true);
      expect(view.state().add(products[3]!)).toBe(false);
    });
    expect(view.state().products.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(view.state().canAdd).toBe(false);
    expect(view.state().error).toContain("up to three");
  });

  it("keeps insertion order, permits removal at the cap, and resets completely", () => {
    const view = setupCompare();
    act(() =>
      products.slice(0, 3).forEach((product) => view.state().add(product)),
    );
    act(() => view.state().toggle(second));
    expect(view.state().isSelected(second.id)).toBe(false);
    expect(view.state().canAdd).toBe(true);
    act(() => view.state().add(products[3]!));
    expect(view.state().products.map(({ id }) => id)).toEqual([1, 3, 4]);
    act(() => view.state().clear());
    expect(view.state().products).toEqual([]);
    expect(view.state().error).toBeNull();
    expect(view.state().canAdd).toBe(true);
  });

  it("keeps comparison ephemeral across a provider remount without writing browser storage", () => {
    const setLocal = vi.spyOn(Storage.prototype, "setItem");
    const view = setupCompare();
    act(() => view.state().add(first));
    expect(view.state().has(first.id)).toBe(true);
    view.unmount();
    const next = setupCompare();
    expect(next.state().products).toEqual([]);
    expect(setLocal).not.toHaveBeenCalled();
  });
});
