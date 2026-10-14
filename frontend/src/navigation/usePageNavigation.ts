import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function usePageNavigation(
  title: string,
  target: "heading" | "main" = "heading",
) {
  const { pathname } = useLocation();
  const focusedPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    document.title = title;
    if (focusedPath.current === pathname) return;
    focusedPath.current = pathname;
    const element = document.querySelector<HTMLElement>(
      target === "main" ? "#main-content" : "#main-content h1",
    );
    element?.focus({ preventScroll: true });
    if (window.scrollX !== 0 || window.scrollY !== 0)
      window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  }, [pathname, target, title]);
}
