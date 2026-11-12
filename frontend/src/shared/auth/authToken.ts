/**
 * Where the signed-in person's access token lives, and how the rest of the
 * app hears that it stopped working.
 *
 * The token is a JWT the backend issues at sign-in. It is kept in
 * localStorage so a reload or a new tab stays signed in until it expires.
 */

const TOKEN_KEY = "pdp-auth-token";
const UNAUTHORISED_EVENT = "pdp:unauthorised";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode or blocked storage: the session lasts for this page only.
  }
}

/**
 * Called by the HTTP client when the server answers 401 to a request that
 * carried a token: the session is over, whatever the UI thought.
 */
export function notifyUnauthorised(): void {
  setAuthToken(null);
  window.dispatchEvent(new Event(UNAUTHORISED_EVENT));
}

export function onUnauthorised(handler: () => void): () => void {
  window.addEventListener(UNAUTHORISED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORISED_EVENT, handler);
}
