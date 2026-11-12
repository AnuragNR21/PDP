import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { routeCatalog } from "./routeCatalog.mjs";

test("route catalog covers the governed trial surface", () => {
  assert.equal(routeCatalog[0], "/home");
  assert.equal(routeCatalog.at(-1), "/admin/audit");
  assert.equal(new Set(routeCatalog).size, routeCatalog.length);
  assert.ok(routeCatalog.includes("/improve/verification"));
  assert.ok(routeCatalog.includes("/improve/demo-story-pack"));
  assert.ok(routeCatalog.includes("/settings/organisation"));
  assert.ok(routeCatalog.includes("/admin/audit"));
  assert.ok(routeCatalog.length >= 22);
});

/**
 * The smoke catalogue and the route manifest are two hand-written lists of the
 * same thing, so they drift: `/admin/retention` and `/rules` were in one and
 * not the other, and the catalogue still walked `/structure/tree`, a route the
 * router has never had. This fails the moment they disagree again.
 *
 * The manifest is read as text rather than imported because `node --test`
 * cannot load TypeScript, and adding a build step to check a list would cost
 * more than the list is worth.
 */
test("the smoke catalogue and the route manifest hold the same routes", () => {
  const manifestPath = fileURLToPath(new URL("../src/app/routeManifest.ts", import.meta.url));
  const source = readFileSync(manifestPath, "utf8");
  const declared = [...source.matchAll(/route:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(declared.length > 0, "no routes were found in routeManifest.ts");

  const onlyInManifest = declared.filter((route) => !routeCatalog.includes(route));
  const onlyInCatalog = routeCatalog.filter((route) => !declared.includes(route));

  assert.deepEqual(
    { onlyInManifest, onlyInCatalog },
    { onlyInManifest: [], onlyInCatalog: [] },
    "routeManifest.ts and tests/routeCatalog.mjs disagree about which routes exist"
  );
});
