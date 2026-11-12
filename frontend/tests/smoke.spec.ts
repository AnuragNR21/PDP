import { routeCatalog } from "./routeCatalog.mjs";
import { expect, test } from "./fixtures";

test.describe("PDP governed route smoke", () => {
  for (const route of routeCatalog) {
    test(`route ${route} renders without shell failure`, async ({ page }) => {
      await page.goto(route);
      // Scoped to the app bar: Home repeats the name in its own heading.
      await expect(page.getByRole("banner").getByText("Power Data Platform")).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Unexpected Application Error");
    });
  }

  test("the sign-in page refuses a wrong password and the shell is closed to strangers", async ({ browser, baseURL }) => {
    // A context of its own: the shared `page` fixture signs in on every load.
    const stranger = await browser.newContext({ baseURL });
    const page = await stranger.newPage();
    try {
      await page.goto("/home");
      await expect(page).toHaveURL(/\/login$/);
      await page.getByLabel("Email").fill("admin@solutionadvisor.com.au");
      await page.getByLabel("Password").fill("definitely-not-the-password");
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByText("Invalid email or password.")).toBeVisible();
    } finally {
      await stranger.close();
    }
  });

  test("an administrator can invite a user, see the link, and cancel the invitation", async ({ page }) => {
    // Self-cleaning: the invited account is removed again at the end, so a
    // run leaves nothing behind in the database it ran against.
    const email = `smoke-invite-${Date.now()}@example.com`;
    await page.goto("/admin/users");
    await page.getByRole("button", { name: /invite user/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Display name").fill("Smoke Invitee");
    await dialog.getByRole("checkbox", { name: /analyst/i }).check();
    await dialog.getByRole("button", { name: /^invite$/i }).click();

    const linkDialog = page.getByRole("dialog", { name: /invitation link/i });
    await expect(linkDialog.getByLabel("Link")).toHaveValue(/\/accept-invitation\/.+/);
    await linkDialog.getByRole("button", { name: /close/i }).click();

    // The new account is listed and selected, as Invited.
    await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Invited");
    await page.getByRole("button", { name: /cancel invitation/i }).first().click();
    await page.getByRole("dialog", { name: /cancel this invitation/i }).getByRole("button", { name: /cancel invitation/i }).click();
    await expect(page.getByRole("row", { name: new RegExp(email) })).toHaveCount(0);
  });

  test("a refused action tells the person they lack the role, whatever the page does with it", async ({ page }) => {
    // The server's answer is stood in for, so this needs no account without
    // roles and leaves nothing behind.
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "This action requires the Analyst role." }) });
    });
    await page.goto("/profile");
    const name = page.getByLabel("Display name");
    await name.fill(`${await name.inputValue()} x`);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /not permitted: this action requires the analyst role/i })).toBeVisible();
  });

  test("trial launcher and demo story pack routes expose core controls", async ({ page }) => {
    await page.goto("/home/trial-launcher");
    await expect(page.getByRole("heading", { name: /trial launcher/i })).toBeVisible();

    await page.goto("/improve/demo-story-pack");
    await expect(page.getByRole("heading", { name: /demo story pack/i })).toBeVisible();
  });
});
