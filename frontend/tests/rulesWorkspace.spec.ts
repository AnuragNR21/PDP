import { type APIRequestContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The Rule Workspace, through the browser.
 *
 * Every rule these tests need is written through the API and removed again
 * afterwards, so the suite leaves the library exactly as it found it and two
 * runs never collide. Selectors are the ones the components actually expose:
 * a labelled control is addressed by its label, and anything unlabelled by
 * the text a person reads.
 */

const API = "/api/rules";

/** A name nothing already in the library can have. */
const unique = (label: string) =>
  `ZZ Playwright ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function backendIsUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/catalogue`)).ok();
  } catch {
    return false;
  }
}

async function createRule(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const response = await request.post(API, {
    data: {
      name: unique("rule"),
      description: "Written by the Playwright suite.",
      category: "ZZ Playwright",
      definition_kind: "builtin",
      check_type: "mandatory",
      parameters: {},
      severity: "high",
      status: "active",
      dimension: "completeness",
      data_type: "any",
      rationale: "Covers the rule library rendering.",
      ...overrides,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function openWorkspace(page: Page) {
  await page.goto("/rules");
  await expect(page.getByRole("button", { name: "New rule" }).first()).toBeVisible();
}

test.describe("Rule Workspace", () => {
  const created: string[] = [];

  test.beforeEach(async ({ request }) => {
    test.skip(!(await backendIsUp(request)), "the API is not reachable — start the backend");
  });

  test.afterEach(async ({ request }) => {
    // Written by this suite, so removed by it: a run that leaves rules behind
    // changes what the next run sees.
    while (created.length) {
      await request.delete(`${API}/${created.pop()}`);
    }
  });

  test("a rule appears in the library with the severity it was given", async ({
    page,
    request,
  }) => {
    const rule = await createRule(request, { severity: "high" });
    created.push(rule.rule_definition_id);

    await openWorkspace(page);
    await page.getByPlaceholder("Search rules…").fill(rule.name);

    await expect(page.getByText(rule.name, { exact: true })).toBeVisible();
    // Severity is authored here and read everywhere else, so the library has
    // to show which level a rule carries.
    await expect(page.getByText("High", { exact: true }).first()).toBeVisible();
  });

  test("searching narrows the library and clearing it brings the rules back", async ({
    page,
    request,
  }) => {
    const kept = await createRule(request, { name: unique("kept") });
    const other = await createRule(request, { name: unique("other") });
    created.push(kept.rule_definition_id, other.rule_definition_id);

    await openWorkspace(page);
    const search = page.getByPlaceholder("Search rules…");

    await search.fill(kept.name);
    await expect(page.getByText(kept.name, { exact: true })).toBeVisible();
    await expect(page.getByText(other.name, { exact: true })).toHaveCount(0);

    await search.fill("");
    await expect(page.getByText(other.name, { exact: true })).toBeVisible();
  });

  test("the library can be filtered to one category", async ({ page, request }) => {
    const mine = await createRule(request, { category: "ZZ Playwright" });
    created.push(mine.rule_definition_id);

    await openWorkspace(page);
    await page.getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("option").filter({ hasText: "ZZ Playwright" }).first().click();

    await expect(page.getByText(mine.name, { exact: true })).toBeVisible();
  });

  test("the editor exposes the fields a rule is written from", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "New rule" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Rule name" })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Category" })).toBeVisible();
    // The editor is where severity is set. If this control ever disappears,
    // every severity downstream silently becomes the default.
    await expect(dialog.getByRole("combobox", { name: "Severity" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create rule" })).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("severity offers exactly the three levels the platform has", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "New rule" }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Severity" }).click();
    // "Critical" is not a level this platform has; the editor must never be
    // able to write one the rest of the system cannot read.
    await expect(page.getByRole("option")).toHaveText(["Low", "Medium", "High"]);

    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});
