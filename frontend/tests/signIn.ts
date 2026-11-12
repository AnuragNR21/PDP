/**
 * How the Playwright suite signs in (PDP-251 put every page behind a session).
 *
 * PDP_SMOKE_EMAIL / PDP_SMOKE_PASSWORD name the account. It must hold every
 * role the walked pages need (Admin for /admin) and must not be waiting on a
 * first-use password change, because that sends every page to /profile.
 * The seeded administrator is the default, which works once its password
 * has been changed to the one given here.
 */
import type { APIRequestContext, Page } from "@playwright/test";

const EMAIL = process.env.PDP_SMOKE_EMAIL ?? "admin@solutionadvisor.com.au";
const PASSWORD = process.env.PDP_SMOKE_PASSWORD ?? "";

export const TOKEN_KEY = "pdp-auth-token";

type LoginBody = { access_token: string; user: { must_change_password: boolean } };

async function login(request: APIRequestContext, password: string): Promise<LoginBody | null> {
  const response = await request.post("/api/auth/login", { data: { email: EMAIL, password } });
  if (!response.ok()) return null;
  return (await response.json()) as LoginBody;
}

let cachedToken: string | null = null;

/** A bearer token for the smoke account, signing in (and settling its first-use password) if needed. */
export async function obtainToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) {
    const check = await request.get("/api/auth/me", { headers: { Authorization: `Bearer ${cachedToken}` } });
    if (check.ok()) return cachedToken;
    cachedToken = null;
  }
  if (!PASSWORD) {
    throw new Error("Set PDP_SMOKE_PASSWORD (and PDP_SMOKE_EMAIL unless the seeded administrator is meant) to run the smoke suite.");
  }
  const session = await login(request, PASSWORD);
  if (!session) throw new Error(`Could not sign in as ${EMAIL}: check PDP_SMOKE_EMAIL / PDP_SMOKE_PASSWORD.`);
  if (session.user.must_change_password) {
    throw new Error(`${EMAIL} must change its password before the smoke suite can use it: sign in once and set a new one, then pass it as PDP_SMOKE_PASSWORD.`);
  }
  cachedToken = session.access_token;
  return cachedToken;
}

/** Puts the token where the app looks for it, before the first page loads. */
export async function signIn(page: Page): Promise<void> {
  const token = await obtainToken(page.request);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TOKEN_KEY, token]
  );
}
