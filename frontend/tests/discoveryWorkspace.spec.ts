import { type APIRequestContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The Discovery Workspace, through the browser.
 *
 * Each test builds its own session through the API, drives the UI, and
 * deletes the session afterwards. Nothing depends on data that happens to be
 * in the database, which is what keeps the suite honest when it is run twice
 * or on someone else's machine.
 *
 * The step buttons carry no accessible name of their own, so they are
 * addressed by the text a person reads on them rather than by role name.
 */

const API = "/api/discover";

const unique = (label: string) =>
  `ZZ Playwright ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const SWITCHES =
  "Asset ID,Fuse Rating,Environment\n" +
  "SW-1,63,outdoor\nSW-1,100,indoor\n,200,both\nSW-4,,outdoor\n";

async function backendIsUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/sessions`)).ok();
  } catch {
    return false;
  }
}

async function newSession(request: APIRequestContext, label: string) {
  const created = await request.post(`${API}/sessions`, {
    data: { name: unique(label), source_name: "" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const session = (await created.json()).session;
  return { id: session.session_id as string, name: session.name as string };
}

/** Upload a file and wait for the workers to read it, as the screen does. */
async function importFile(
  request: APIRequestContext,
  sessionId: string,
  filename: string,
  body: string
) {
  const uploaded = await request.post(
    `${API}/sessions/${sessionId}/files/upload?filename=${encodeURIComponent(filename)}`,
    { headers: { "content-type": "text/csv" }, data: body }
  );
  expect(uploaded.status(), await uploaded.text()).toBe(201);

  await request.post(`${API}/sessions/${sessionId}/import/run`);
  await expect
    .poll(
      async () =>
        (
          await (await request.get(`${API}/sessions/${sessionId}/import/progress`)).json()
        ).is_working,
      { timeout: 120_000, message: "the import never settled" }
    )
    .toBe(false);
}

/**
 * Open the workspace on a session.
 *
 * By address, not by driving the picker: the session is a segment of the URL
 * now, so this is both what a person's bookmark does and one less piece of
 * chrome for these tests to depend on.
 */
async function openSession(page: Page, sessionId: string) {
  await page.goto(`/discover/mapping/${sessionId}`);
  await expect(step(page, 1)).toBeVisible();
}

/** The stepper's nth card. Named by the words on it, which it does have. */
const step = (page: Page, n: number) =>
  page.locator("button").filter({ hasText: new RegExp(`^Step ${n}`) }).first();

test.describe("Discovery Workspace", () => {
  const sessions: string[] = [];

  test.beforeEach(async ({ request }) => {
    test.skip(!(await backendIsUp(request)), "the API is not reachable — start the backend");
  });

  test.afterEach(async ({ request }) => {
    while (sessions.length) {
      await request.delete(`${API}/sessions/${sessions.pop()}`);
    }
  });

  test("the import step counts the files uploaded, not the tables they held", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "import");
    sessions.push(session.id);

    await importFile(request, session.id, "switches.csv", SWITCHES);
    await importFile(request, session.id, "poles.csv", "Pole ID,Material\nP-1,Wood\n");

    await openSession(page, session.id);
    await expect(page.getByText("switches.csv", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("poles.csv", { exact: false }).first()).toBeVisible();
    // Uploading two files and finding only the last one downstream is the bug
    // this guards; the step counts files, because a file is what was chosen.
    await expect(page.getByText(/2 files uploaded/i)).toBeVisible();
  });

  test("the preview shows the first rows and reveals the rest of the columns", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "preview");
    sessions.push(session.id);

    const wide =
      Array.from({ length: 20 }, (_, i) => `Field ${i}`).join(",") +
      "\n" +
      Array.from({ length: 30 }, (_, r) =>
        Array.from({ length: 20 }, (_, c) => `v${r}-${c}`).join(",")
      ).join("\n") +
      "\n";
    await importFile(request, session.id, "wide.csv", wide);
    await request.post(`${API}/sessions/${session.id}/profile-all`);

    await openSession(page, session.id);
    await step(page, 2).click();

    // Ten rows, not fifty: a preview answers what the data looks like, and
    // every extra row is one cell per column for the browser to build.
    await expect(page.getByText(/first 10 of 30 rows/i)).toBeVisible();
    await expect(page.getByText(/12 of 20 columns/i)).toBeVisible();
    await page.getByRole("button", { name: /show all columns/i }).click();
    await expect(page.getByText(/all 20 columns/i)).toBeVisible();
  });

  test("the column list grows as it is scrolled rather than rendering at once", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "lazy");
    sessions.push(session.id);

    const wide =
      Array.from({ length: 60 }, (_, i) => `Field ${i}`).join(",") +
      "\n" +
      Array.from({ length: 3 }, (_, r) =>
        Array.from({ length: 60 }, (_, c) => `v${r}-${c}`).join(",")
      ).join("\n") +
      "\n";
    await importFile(request, session.id, "wide.csv", wide);
    await request.post(`${API}/sessions/${session.id}/profile-all`);

    await openSession(page, session.id);
    await step(page, 2).click();

    const counter = page.getByText(/of 60 — scroll for more/i);
    await expect(counter).toHaveText(/^25 of 60/);
    await page.getByText("Field 24", { exact: true }).scrollIntoViewIfNeeded();
    // Reaching the end of what is rendered asks for the next batch. This is
    // the behaviour that silently stopped working under StrictMode once.
    await expect(page.getByText(/of 60/)).not.toHaveText(/^25 of 60/, { timeout: 10_000 });
  });

  test("table tabs are offered where a table is chosen, and gone where it is not", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "tabs");
    sessions.push(session.id);

    await importFile(request, session.id, "switches.csv", SWITCHES);
    await importFile(request, session.id, "poles.csv", "Pole ID,Material\nP-1,Wood\n");
    await request.post(`${API}/sessions/${session.id}/profile-all`);

    await openSession(page, session.id);

    // Profile and Mapping work on one table at a time, so which one is open
    // is the whole question.
    await step(page, 2).click();
    await expect(page.getByText("2 tables", { exact: true })).toBeVisible();
    await step(page, 3).click();
    await expect(page.getByText("2 tables", { exact: true })).toBeVisible();

    // From Rules on, every step lists every mapped field of every table
    // together, so a tab strip there would switch nothing.
    await step(page, 4).click();
    await expect(page.getByText("2 tables", { exact: true })).toHaveCount(0);
  });

  test("Quality Check is the last step — there is no Review Evidence", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "steps");
    sessions.push(session.id);
    await importFile(request, session.id, "switches.csv", SWITCHES);

    await openSession(page, session.id);
    await expect(step(page, 5)).toBeVisible();
    await expect(page.getByText("Quality Check", { exact: true })).toBeVisible();
    // The evidence now lives on the Quality step itself, rule by rule.
    await expect(step(page, 6)).toHaveCount(0);
    await expect(page.getByText(/review evidence/i)).toHaveCount(0);
  });

  test("the quality step says what to do when nothing is mapped yet", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "quality");
    sessions.push(session.id);

    await importFile(request, session.id, "switches.csv", SWITCHES);
    await request.post(`${API}/sessions/${session.id}/profile-all`);

    await openSession(page, session.id);
    await step(page, 5).click();

    // Nothing is mapped, so the step asks for a mapping rather than showing
    // a clean result — an unchecked table must not read as a passing one.
    await expect(page.getByText(/map your fields before checking them/i)).toBeVisible();
    await expect(page.getByText("Quality Check Result", { exact: true })).toHaveCount(0);
  });

  test("the open session is in the address, so a reload comes back to it", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "url");
    sessions.push(session.id);
    await importFile(request, session.id, "switches.csv", SWITCHES);

    // Chosen from the list, the address follows.
    await page.goto("/discover/mapping");
    await page.getByText(session.name, { exact: false }).first().click();
    await expect(page).toHaveURL(new RegExp(`/discover/mapping/${session.id}$`));

    // Loaded cold, the same address opens the same session.
    await page.goto(`/discover/mapping/${session.id}`);
    await expect(step(page, 1)).toBeVisible();
    await expect(page.getByText(session.name, { exact: false }).first()).toBeVisible();

    // Back returns to the list rather than stranding the person.
    await page.goBack();
    await expect(page).toHaveURL(/\/discover\/mapping$/);
    await expect(page.getByText(/continue with an existing session/i)).toBeVisible();
  });

  test("a session id that no longer exists lands on the list, not an empty workspace", async ({
    page,
    request,
  }) => {
    test.skip(!(await backendIsUp(request)));
    await page.goto("/discover/mapping/sess_000000000000");
    await expect(page).toHaveURL(/\/discover\/mapping$/, { timeout: 15_000 });
    await expect(page.getByText(/continue with an existing session/i)).toBeVisible();
  });

  test("archive is not offered, or accepted, before the checks have run", async ({
    page,
    request,
  }) => {
    const session = await newSession(request, "archive");
    sessions.push(session.id);
    await importFile(request, session.id, "switches.csv", SWITCHES);

    await openSession(page, session.id);
    // Nothing has been checked, so there is nothing finished to retire.
    await expect(page.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);

    // The endpoint refuses it too, not just the screen.
    const refused = await request.post(`${API}/sessions/${session.id}/archive`);
    expect(refused.status()).toBe(422);
  });

  /*
   * Upload progress is deliberately not covered here.
   *
   * What matters about it is timing — that all four rows appear before any
   * byte lands, and that Start import stays away until the last one does —
   * and that needs files large enough to take measurable time, which means
   * Buffer, which means @types/node, which this repo does not install. It was
   * verified instead by sampling the DOM every 120 ms through a 160 MB upload;
   * see claude/discover-upload-progress.md.
   */
});
