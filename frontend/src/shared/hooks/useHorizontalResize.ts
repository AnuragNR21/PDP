import { useCallback, useEffect, useRef, useState } from 'react';

interface PanelConfig {
  minWidth?: number | string;
  maxWidth?: number | string;
  defaultWidth?: number | string;
}

interface UseHorizontalResizeOptions {
  storageKey: string;
  left: PanelConfig;
  right?: PanelConfig;
}

/**
 * Custom hook for horizontal panel resizing with flexbox
 *
 * Strategy: Let CSS flexbox and min/max-width properties handle constraints
 * instead of JavaScript calculations. This eliminates expensive operations
 * during high-frequency resize events.
 *
 * The hook manages:
 * - Tracking the left panel's flex-basis width
 * - Persisting to localStorage
 * - Mouse drag events to update width
 *
 * Constraints are applied via CSS (min-width, max-width) on the panel itself,
 * not calculated in JavaScript.
 */
export function useHorizontalResize(options: UseHorizontalResizeOptions) {
  const { storageKey, left } = options;

  // Initialize width from localStorage or defaultWidth
  const [width, setWidth] = useState<number | string>(() => {
    if (typeof window === 'undefined') return 360;

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      saved = null;
    }
    if (saved) {
      const savedWidth = Number(saved);
      if (Number.isFinite(savedWidth)) {
        return savedWidth;
      }
    }

    // Use defaultWidth or fallback
    return left.defaultWidth ?? 360;
  });

  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Persist width to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [width, storageKey]);

  // Handle mouse move during resize
  // Simple coordinate math - no constraint calculations here
  const handleResizeMove = useCallback((event: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const nextWidth = Math.max(0, event.clientX - bounds.left);

    setWidth(nextWidth);
  }, []);

  // Stop resize and clean up event listeners
  const stopResize = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', stopResize);
  }, [handleResizeMove]);

  // Start resize and attach event listeners
  const startResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', stopResize);
    },
    [handleResizeMove, stopResize],
  );

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', stopResize);
    };
  }, [handleResizeMove, stopResize]);

  return {
    width,
    isResizing,
    containerRef,
    startResize,
  };
}
