/**
 * `test` with a signed-in `page` and an authenticated `request`.
 *
 * Specs import this instead of "@playwright/test" so none of them has to
 * remember that the API and every page now need a session.
 */
import { test as base, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { obtainToken, signIn } from "./signIn";

export const test = base.extend<{ page: import("@playwright/test").Page; request: APIRequestContext }>({
  page: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
  request: async ({ request, baseURL }, use) => {
    const token = await obtainToken(request);
    const authed = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` }
    });
    await use(authed);
    await authed.dispose();
  }
});

export { expect };
