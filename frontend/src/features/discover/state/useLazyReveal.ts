import { useCallback, useEffect, useState } from "react";

/**
 * Render part of a long list, and more of it as the person reaches the end.
 *
 * A file with ninety columns builds ninety rows in the column list and ninety
 * cells in every preview row, all before anything appears on screen — and the
 * person looks at the first handful. This hands back how many to render and a
 * ref to put on the last one; when that last one is scrolled into view, the
 * next batch is revealed.
 *
 * Reaching the end reveals the next batch rather than the whole remainder:
 * scrolling fast through a thousand columns should not end in rendering a
 * thousand columns at once.
 */
export function useLazyReveal(total: number, initial: number, step: number) {
  const [shown, setShown] = useState(() => Math.min(initial, total));
  // The element to watch is held in state, not a ref, so that the effect below
  // is tied to that element rather than to this component being mounted. An
  // observer created inside a ref callback and torn down on unmount does not
  // survive StrictMode's mount/unmount/remount in development: the teardown
  // kills the observer and nothing recreates it, and the list silently stops
  // growing. Keyed on the node, setup and teardown always pair up.
  const [anchor, setAnchor] = useState<Element | null>(null);
  const lastItemRef = useCallback((node: Element | null) => setAnchor(node), []);

  // A different file, a different list: start again from the first batch.
  // Without this, switching from a wide table to a narrow one would leave the
  // count above the new total and reveal nothing.
  useEffect(() => {
    setShown(Math.min(initial, total));
  }, [total, initial]);

  useEffect(() => {
    if (anchor === null || shown >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // Grow from the count at the time, not from a captured one: two
        // observations in the same frame must not both reveal the same batch.
        setShown((current) => Math.min(current + step, total));
      },
      // Start revealing the next batch slightly before the edge is reached, so
      // the new items are there by the time the person scrolls to them.
      { rootMargin: "240px" }
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor, shown, total, step]);

  const revealAll = useCallback(() => setShown(total), [total]);

  return {
    /** How many items to render right now. */
    shown,
    /** Put this on the last rendered item. */
    lastItemRef,
    /** True once the whole list is on screen. */
    isComplete: shown >= total,
    /** For a "show everything" control, when someone wants the lot. */
    revealAll,
  };
}
