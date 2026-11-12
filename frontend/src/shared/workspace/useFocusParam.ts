import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * A one-off "bring this into focus" address parameter — what the global
 * search uses to open a workspace on the object it found. The page reads it,
 * selects the object, then consumes it so a refresh or a later click is not
 * pulled back to it.
 */
export function useFocusParam(key: string) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  const consume = useCallback(
    /** `alsoKeys`: other params that came with this one, removed in the same update. */
    (...alsoKeys: string[]) =>
      setParams(
        (current) => {
          const keys = [key, ...alsoKeys].filter((name) => current.has(name));
          if (keys.length === 0) return current;
          const next = new URLSearchParams(current);
          for (const name of keys) next.delete(name);
          return next;
        },
        { replace: true },
      ),
    [key, setParams],
  );
  return [value, consume] as const;
}

/**
 * Scroll the element marked with this data attribute into view once it is
 * drawn — and again shortly after, because a workspace that has just opened
 * keeps laying itself out (panels, trees opening) and would otherwise leave
 * the element where the first scroll put it.
 */
export function scrollToMarked(attribute: string, id: string) {
  const selector = `[${attribute}="${CSS.escape(id)}"]`;
  let tries = 0;
  const attempt = () => {
    const element = document.querySelector(selector);
    if (!element) {
      if (tries++ < 30) window.setTimeout(attempt, 100);
      return;
    }
    element.scrollIntoView({ block: "center" });
    for (const delay of [300, 800]) {
      window.setTimeout(() => document.querySelector(selector)?.scrollIntoView({ block: "center" }), delay);
    }
  };
  window.setTimeout(attempt, 50);
}
