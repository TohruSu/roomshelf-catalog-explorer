import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  deleteJson,
  getJson,
  postJson,
  withRequestDeadline,
} from "../api/client";
import type {
  Product,
  SaveShortlistResponse,
  Session,
  SessionResponse,
  ShortlistItem,
  ShortlistResponse,
} from "../api/types";

interface ShortlistState {
  items: ShortlistItem[];
  ids: ReadonlySet<number>;
  status: "loading" | "ready" | "error";
  error: string | null;
  pendingIds: ReadonlySet<number>;
  isSaved: (id: number) => boolean;
  toggle: (product: Product) => Promise<void>;
  save: (product: Product) => Promise<void>;
  remove: (id: number) => Promise<void>;
  retry: () => void;
}

const ShortlistContext = createContext<ShortlistState | null>(null);
const SESSION_ENDED =
  "Your shortlist session ended. Your current shortlist has been refreshed. Please try the action again.";
const UPDATE_UNCONFIRMED =
  "The update could not be confirmed. Your shortlist has been refreshed; check it before trying again.";

// Session creation must outlive a StrictMode effect cleanup. Only the in-flight
// request is shared; tokens and session references stay in memory, never storage.
let bootstrapPromise: Promise<Session> | null = null;

async function requestSession(signal: AbortSignal): Promise<Session> {
  const { data } = await getJson<SessionResponse>("/api/session", signal);
  if (
    !data ||
    typeof data.session_ref !== "string" ||
    typeof data.csrf_token !== "string"
  ) {
    throw new ApiError(
      200,
      "The session returned an unreadable response. Please try again.",
      [],
      "unreadable_response",
    );
  }
  return data;
}

async function coordinatedSession(): Promise<Session> {
  // Concurrent first visits otherwise create two sessions before either tab has
  // a cookie. The browser's origin-scoped lock lets the second tab reuse it.
  // No session identifier or token is exchanged through browser storage.
  return withRequestDeadline(async (signal) => {
    if (!navigator.locks) return requestSession(signal);
    let started = false;
    try {
      return await navigator.locks.request(
        "roomshelf-session-bootstrap",
        { signal },
        () => {
          // A late lock callback must not start a cookie request after expiry.
          signal.throwIfAborted();
          started = true;
          return requestSession(signal);
        },
      );
    } catch (failure) {
      // Unsupported or denied locks use the normal session-change recovery.
      // Timeout, cancellation, or an acquired request failure are not retried.
      if (started || signal.aborted) throw failure;
      return requestSession(signal);
    }
  });
}

function bootstrapSession(): Promise<Session> {
  if (!bootstrapPromise) {
    bootstrapPromise = coordinatedSession().finally(() => {
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The shortlist request failed. Please try again.";
}

export function ShortlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ShortlistItem[]>([]);
  const itemsRef = useRef<ShortlistItem[]>([]);
  const [status, setStatus] = useState<ShortlistState["status"]>("loading");
  const readyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  const pendingRef = useRef(new Set<number>());
  const sessionRef = useRef<Session | null>(null);
  const mountedRef = useRef(false);
  const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  const invalidateReads = useCallback(() => {
    readGeneration.current += 1;
    readController.current?.abort();
  }, []);

  const clearMembership = useCallback(() => {
    itemsRef.current = [];
    readyRef.current = false;
    if (mountedRef.current) setItems([]);
  }, []);

  const failRead = useCallback(
    (failure: unknown, prefix?: string) => {
      clearMembership();
      if (!mountedRef.current) return;
      setStatus("error");
      setError(
        prefix ? `${prefix} ${messageFor(failure)}` : messageFor(failure),
      );
    },
    [clearMembership],
  );

  const readItems = useCallback(async () => {
    invalidateReads();
    const generation = readGeneration.current;
    const controller = new AbortController();
    readController.current = controller;
    let result: ShortlistResponse;
    try {
      result = await getJson<ShortlistResponse>(
        "/api/shortlist",
        controller.signal,
      );
    } catch (failure) {
      if (!mountedRef.current || generation !== readGeneration.current)
        return false;
      throw failure;
    }
    if (!mountedRef.current || generation !== readGeneration.current)
      return false;
    if (!Array.isArray(result.data))
      throw new ApiError(
        200,
        "The shortlist returned an unreadable response. Please try again.",
      );
    itemsRef.current = result.data;
    readyRef.current = true;
    setItems(result.data);
    setStatus("ready");
    return true;
  }, [invalidateReads]);

  const load = useCallback(async () => {
    if (pendingRef.current.size) return;
    invalidateReads();
    let generation = readGeneration.current;
    clearMembership();
    setStatus("loading");
    setError(null);
    try {
      const session = await bootstrapSession();
      if (!mountedRef.current || generation !== readGeneration.current) return;
      sessionRef.current = session;
      const reading = readItems();
      generation = readGeneration.current;
      await reading;
    } catch (failure) {
      if (!mountedRef.current || generation !== readGeneration.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      failRead(failure);
    }
  }, [clearMembership, failRead, invalidateReads, readItems]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      invalidateReads();
    };
  }, [invalidateReads, load]);

  const renewSession = useCallback(async () => {
    invalidateReads();
    clearMembership();
    setStatus("loading");
    try {
      sessionRef.current = await bootstrapSession();
      if (!mountedRef.current) return;
      if (await readItems()) setError(SESSION_ENDED);
    } catch (failure) {
      failRead(
        failure,
        "Your shortlist session ended. Please reload your shortlist before trying again.",
      );
    }
  }, [clearMembership, failRead, invalidateReads, readItems]);

  const write = useCallback(
    (id: number, saved: boolean): Promise<void> => {
      const intendedSession = sessionRef.current;
      if (
        !mountedRef.current ||
        !readyRef.current ||
        !intendedSession ||
        pendingRef.current.has(id)
      )
        return Promise.resolve();
      pendingRef.current.add(id);
      setPendingIds(new Set(pendingRef.current));

      const operation = async () => {
        if (!mountedRef.current) return;
        // Failed reconciliation already explains that the result is unknown.
        // Cancel waiting writes without replacing that actionable message.
        if (!readyRef.current) return;
        if (sessionRef.current?.session_ref !== intendedSession.session_ref) {
          setError(
            "Your shortlist changed while this action was waiting. Please check it and try again.",
          );
          return;
        }
        invalidateReads();
        setError(null);
        const send = async (session: Session) => {
          if (saved) {
            const result = await postJson<SaveShortlistResponse>(
              "/api/shortlist/items",
              { product_id: id },
              session.csrf_token,
            );
            if (result.data?.product_id !== id || result.data.saved !== true) {
              throw new ApiError(
                200,
                "The shortlist returned an unreadable response. Please try again.",
                [],
                "unreadable_response",
              );
            }
          } else {
            await deleteJson(`/api/shortlist/items/${id}`, session.csrf_token);
          }
        };

        let responseAccepted = false;
        try {
          let currentSession = sessionRef.current;
          if (!currentSession) return;
          try {
            await send(currentSession);
          } catch (failure) {
            if (
              !(failure instanceof ApiError) ||
              failure.status !== 403 ||
              failure.code !== "csrf_invalid"
            )
              throw failure;
            const refreshed = await bootstrapSession();
            if (!mountedRef.current) return;
            if (refreshed.session_ref !== currentSession.session_ref) {
              sessionRef.current = refreshed;
              clearMembership();
              setStatus("loading");
              if (await readItems()) setError(SESSION_ENDED);
              return;
            }
            sessionRef.current = refreshed;
            currentSession = refreshed;
            // csrf_invalid is guaranteed to precede a mutation. Retry it once only.
            await send(currentSession);
          }
          responseAccepted = true;
          if (!mountedRef.current) return;
          await readItems();
        } catch (failure) {
          if (!mountedRef.current) return;
          if (failure instanceof ApiError && failure.status === 401) {
            await renewSession();
          } else if (
            !responseAccepted &&
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500
          ) {
            setError(messageFor(failure));
          } else {
            // A timeout, 5xx, or unreadable success can follow a committed write.
            // Reconcile against the server without replaying the mutation.
            clearMembership();
            setStatus("loading");
            try {
              const refreshed = await bootstrapSession();
              if (!mountedRef.current) return;
              const changed =
                refreshed.session_ref !== intendedSession.session_ref;
              sessionRef.current = refreshed;
              if (await readItems())
                setError(changed ? SESSION_ENDED : UPDATE_UNCONFIRMED);
            } catch (readFailure) {
              failRead(
                readFailure,
                "The update could not be confirmed. Please reload your shortlist before trying again.",
              );
            }
          }
        }
      };

      const queued = writeQueue.current.then(operation);
      const settled = queued.finally(() => {
        pendingRef.current.delete(id);
        if (mountedRef.current) setPendingIds(new Set(pendingRef.current));
      });
      // Continue the queue after a failure without leaking an unhandled rejection.
      writeQueue.current = settled.catch(() => undefined);
      return writeQueue.current;
    },
    [clearMembership, failRead, invalidateReads, readItems, renewSession],
  );

  const save = useCallback(
    (product: Product) => write(product.id, true),
    [write],
  );
  const remove = useCallback((id: number) => write(id, false), [write]);
  const toggle = useCallback(
    (product: Product) =>
      write(
        product.id,
        !itemsRef.current.some((item) => item.product.id === product.id),
      ),
    [write],
  );
  const retry = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo<ShortlistState>(
    () => ({
      items,
      ids: new Set(items.map((item) => item.product.id)),
      status,
      error,
      pendingIds,
      isSaved: (id) => items.some((item) => item.product.id === id),
      toggle,
      save,
      remove,
      retry,
    }),
    [items, status, error, pendingIds, toggle, save, remove, retry],
  );

  return (
    <ShortlistContext.Provider value={value}>
      {children}
    </ShortlistContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- This hook uses the provider's private context.
export function useShortlist() {
  const value = useContext(ShortlistContext);
  if (!value)
    throw new Error("useShortlist must be used within ShortlistProvider.");
  return value;
}
