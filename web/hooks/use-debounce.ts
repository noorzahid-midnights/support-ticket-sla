"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a fast-changing value (the search box) so it only becomes a query
 * key once typing pauses. Without this every keystroke is a request.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
