import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Product } from "../api/types";

interface CompareState {
  products: Product[];
  error: string | null;
  canAdd: boolean;
  isSelected: (id: number) => boolean;
  has: (id: number) => boolean;
  add: (product: Product) => boolean;
  remove: (id: number) => void;
  toggle: (product: Product) => void;
  clear: () => void;
}

const CompareContext = createContext<CompareState | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const productsRef = useRef<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback((product: Product) => {
    if (productsRef.current.some((item) => item.id === product.id)) {
      setError(null);
      return true;
    }
    if (productsRef.current.length === 3) {
      setError(
        "Compare up to three products. Remove one before adding another.",
      );
      return false;
    }
    productsRef.current = [...productsRef.current, product];
    setProducts(productsRef.current);
    setError(null);
    return true;
  }, []);

  const remove = useCallback((id: number) => {
    productsRef.current = productsRef.current.filter(
      (product) => product.id !== id,
    );
    setProducts(productsRef.current);
    setError(null);
  }, []);

  const toggle = useCallback(
    (product: Product) => {
      if (productsRef.current.some((item) => item.id === product.id))
        remove(product.id);
      else add(product);
    },
    [add, remove],
  );

  const clear = useCallback(() => {
    productsRef.current = [];
    setProducts([]);
    setError(null);
  }, []);

  const value = useMemo<CompareState>(
    () => ({
      products,
      error,
      canAdd: products.length < 3,
      isSelected: (id) => products.some((product) => product.id === id),
      has: (id) => products.some((product) => product.id === id),
      add,
      remove,
      toggle,
      clear,
    }),
    [products, error, add, remove, toggle, clear],
  );

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- This hook uses the provider's private context.
export function useCompare() {
  const value = useContext(CompareContext);
  if (!value)
    throw new Error("useCompare must be used within CompareProvider.");
  return value;
}
