/**
 * How the rest of the app hears that the server refused something.
 *
 * The HTTP client raises these from one place, so a page that swallows its
 * own errors still cannot hide a refusal from the person: a listener near
 * the root turns each one into a toast.
 */

const FORBIDDEN_EVENT = "pdp:forbidden";

export interface ForbiddenDetail {
  /** The server's own sentence, e.g. "This action requires the Analyst role." */
  message: string;
  url: string;
}

export function notifyForbidden(detail: ForbiddenDetail): void {
  window.dispatchEvent(new CustomEvent<ForbiddenDetail>(FORBIDDEN_EVENT, { detail }));
}

export function onForbidden(handler: (detail: ForbiddenDetail) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<ForbiddenDetail>).detail);
  window.addEventListener(FORBIDDEN_EVENT, listener);
  return () => window.removeEventListener(FORBIDDEN_EVENT, listener);
}
