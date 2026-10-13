import { useEffect, useRef, useState } from "react";
import { ApiError, getJson } from "./client";

export function useRequest<T>(path: string | null, attempt = 0) {
  const [state, setState] = useState<{
    data: T | null;
    error: ApiError | null;
    loading: boolean;
  }>({ data: null, error: null, loading: path !== null });
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    if (!path) return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, error: null, loading: true }));
    void getJson<T>(path, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && current === generation.current)
          setState({ data, error: null, loading: false });
      },
      (error) => {
        if (!controller.signal.aborted && current === generation.current)
          setState((previous) => ({
            ...previous,
            error:
              error instanceof ApiError
                ? error
                : new ApiError(
                    0,
                    "Unable to load the catalog. Please try again.",
                  ),
            loading: false,
          }));
      },
    );
    return () => controller.abort();
  }, [path, attempt]);
  return state;
}
