/**
 * Shows a toast whenever the server answers 403, whatever page raised it.
 * Mounted once under the ToastProvider.
 */
import { useEffect, useRef } from "react";
import { useToast } from "@/shared/toast/ToastContext";
import { onForbidden } from "./httpNotices";

// A page that fires several requests at once would otherwise stack the same
// sentence several times over.
const REPEAT_WINDOW_MS = 2000;

export function ForbiddenNotice() {
  const { showToast } = useToast();
  const last = useRef<{ message: string; at: number }>({ message: "", at: 0 });

  useEffect(
    () =>
      onForbidden(({ message }) => {
        const now = Date.now();
        if (message === last.current.message && now - last.current.at < REPEAT_WINDOW_MS) return;
        last.current = { message, at: now };
        showToast(`Not permitted: ${message} Ask an administrator if you need this access.`, "warning", 6000);
      }),
    [showToast]
  );

  return null;
}
