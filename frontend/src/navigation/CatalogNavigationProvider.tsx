import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import {
  CatalogNavigationContext,
  type CatalogPosition,
} from "./catalogNavigation";

export function CatalogNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const positions = useRef(new Map<string, CatalogPosition>());
  const value = useMemo(
    () => ({
      remember(position: CatalogPosition) {
        positions.current.delete(position.sourceKey);
        positions.current.set(position.sourceKey, position);
        // Keep navigation memory bounded and local to this mounted application.
        if (positions.current.size > 32) {
          const oldest = positions.current.keys().next().value;
          if (oldest !== undefined) positions.current.delete(oldest);
        }
      },
      find(key: string) {
        return positions.current.get(key);
      },
    }),
    [],
  );
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  return (
    <CatalogNavigationContext.Provider value={value}>
      {children}
    </CatalogNavigationContext.Provider>
  );
}
