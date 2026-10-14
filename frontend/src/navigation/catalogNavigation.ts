import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { catalogReturnPath } from "../catalog/returnPath";

export interface CatalogPosition {
  sourceKey: string;
  path: string;
  productId: number;
  slug: string;
  x: number;
  y: number;
}

export function ensureFocusVisible(element: HTMLElement) {
  if (!element.getClientRects().length) return;
  const rect = element.getBoundingClientRect();
  let clipped =
    rect.top < 0 ||
    rect.left < 0 ||
    rect.bottom > window.innerHeight ||
    rect.right > window.innerWidth;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (
      /(auto|scroll|hidden|clip)/.test(style.overflowY) &&
      (rect.top < bounds.top + parent.clientTop ||
        rect.bottom > bounds.top + parent.clientTop + parent.clientHeight)
    )
      clipped = true;
    if (
      /(auto|scroll|hidden|clip)/.test(style.overflowX) &&
      (rect.left < bounds.left + parent.clientLeft ||
        rect.right > bounds.left + parent.clientLeft + parent.clientWidth)
    )
      clipped = true;
  }
  if (clipped)
    element.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
}

interface CatalogNavigation {
  remember: (position: CatalogPosition) => void;
  find: (key: string) => CatalogPosition | undefined;
}

export const CatalogNavigationContext = createContext<CatalogNavigation | null>(
  null,
);

export function useCatalogNavigation() {
  const value = useContext(CatalogNavigationContext);
  if (!value) throw new Error("Catalog navigation requires its provider.");
  return value;
}

export function catalogSourceKey(state: unknown): string | null {
  return state &&
    typeof state === "object" &&
    "catalogSourceKey" in state &&
    typeof state.catalogSourceKey === "string"
    ? state.catalogSourceKey
    : null;
}

export function useCatalogPosition(ready: boolean, canonicalPath: string) {
  const location = useLocation();
  const [entryKey] = useState(location.key);
  const navigation = useCatalogNavigation();
  const position = useMemo(() => {
    // Query history inside an already-mounted catalog keeps control focus.
    if (location.key !== entryKey) return null;
    const key = catalogSourceKey(location.state) ?? location.key;
    const saved = navigation.find(key);
    return saved &&
      saved.path === canonicalPath &&
      catalogReturnPath(saved.path) === canonicalPath
      ? saved
      : null;
  }, [canonicalPath, entryKey, location.key, location.state, navigation]);
  const finished = useRef(false);

  useEffect(() => {
    if (location.key !== entryKey) finished.current = true;
    if (!position) return;
    const cancel = () => {
      finished.current = true;
    };
    const cancelScroll = () => {
      // The route's deliberate top reset may dispatch after these listeners
      // mount. Gestures below still cancel an attempted scroll at the top.
      if (window.scrollX !== 0 || window.scrollY !== 0) cancel();
    };
    const cancelKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        cancel();
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("scroll", cancelScroll, { passive: true });
    window.addEventListener("keydown", cancelKey);
    window.addEventListener("focusin", cancel);
    window.addEventListener("input", cancel);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("scroll", cancelScroll);
      window.removeEventListener("keydown", cancelKey);
      window.removeEventListener("focusin", cancel);
      window.removeEventListener("input", cancel);
    };
  }, [entryKey, location.key, position]);

  useEffect(() => {
    if (
      !ready ||
      !position ||
      finished.current ||
      navigation.find(position.sourceKey) !== position
    )
      return;
    finished.current = true;
    const link = document.querySelector<HTMLAnchorElement>(
      `#main-content a[data-catalog-product-id="${position.productId}"]`,
    );
    if (!link) return;
    link.focus({ preventScroll: true });
    const maxX = Math.max(
      0,
      document.documentElement.scrollWidth - window.innerWidth,
    );
    const maxY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const left = Math.min(Math.max(0, position.x), maxX);
    const top = Math.min(Math.max(0, position.y), maxY);
    if (window.scrollX !== left || window.scrollY !== top)
      window.scrollTo({ left, top, behavior: "instant" });
    // Saved pixels can point below the focused card after responsive reflow.
    // Keep exact coordinates when that card is still visible.
    ensureFocusVisible(link);
  }, [navigation, position, ready]);
}
