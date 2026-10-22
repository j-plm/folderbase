import { useCallback, useRef } from "react";
import { useVirtualizer, type Range, type Virtualizer } from "@tanstack/react-virtual";
import { scrollAheadIndexes } from "../lib/virtualRange";

/**
 * `useVirtualizer` that renders ahead of the scroll: a screen above and below
 * what's visible, and another screen in the direction of travel.
 */
export function useScrollAheadVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: Omit<Parameters<typeof useVirtualizer<TScrollElement, TItemElement>>[0], "rangeExtractor">
): Virtualizer<TScrollElement, TItemElement> {
  const ref = useRef<Virtualizer<TScrollElement, TItemElement> | null>(null);
  const rangeExtractor = useCallback((range: Range) => scrollAheadIndexes(range, ref.current?.scrollDirection ?? null), []);
  const virtualizer = useVirtualizer<TScrollElement, TItemElement>({ ...options, rangeExtractor });
  ref.current = virtualizer;
  return virtualizer;
}
