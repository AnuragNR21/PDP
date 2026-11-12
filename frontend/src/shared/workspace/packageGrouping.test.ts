import assert from "node:assert/strict";
import test from "node:test";
import { groupByPackage } from "./packageGrouping.ts";

const packages = [
  { id: "shared-models", name: "Shared Models" },
  { id: "p-bi", name: "Business Information Model" },
  { id: "p-empty", name: "Utility" },
];
type M = { id: string; name: string; pkg: string };
const models: M[] = [
  { id: "a", name: "Asset", pkg: "shared-models" },
  { id: "b", name: "Business Information", pkg: "p-bi" },
  { id: "m", name: "Module", pkg: "p-bi" },
  { id: "x", name: "Orphan", pkg: "p-deleted" },
];
const group = (input: Partial<Parameters<typeof groupByPackage<M>>[2]>) =>
  groupByPackage(packages, (m: M) => m.pkg, { all: models, passing: models, shown: models, query: "", filtered: false, ...input });
const names = (groups: ReturnType<typeof group>) => groups.map((g) => [g.pkg.name, g.entries.map((m) => m.name)]);

test("models sit under their packages, in package order; an empty package still shows", () => {
  assert.deepEqual(names(group({})), [
    ["Shared Models", ["Asset", "Orphan"]],
    ["Business Information Model", ["Business Information", "Module"]],
    ["Utility", []],
  ]);
});

test("a model in a package that no longer exists is shown under Shared Models", () => {
  const shared = group({})[0];
  assert.equal(shared.total, 2);
  assert.ok(shared.entries.some((m) => m.id === "x"));
});

test("a filter hides packages with nothing to show, but keeps the totals", () => {
  const passing = models.filter((m) => m.id !== "a" && m.id !== "x");
  const groups = group({ passing, shown: passing, filtered: true });
  assert.deepEqual(names(groups), [["Business Information Model", ["Business Information", "Module"]]]);
  assert.equal(groups[0].total, 2);
});

test("a search keeps the packages with a match", () => {
  const shown = models.filter((m) => m.name.toLowerCase().includes("modu"));
  assert.deepEqual(names(group({ shown, query: "modu" })), [["Business Information Model", ["Module"]]]);
});

test("a search that matches a package's name shows all of its filtered models", () => {
  assert.deepEqual(names(group({ shown: [], query: "business information model" })), [
    ["Business Information Model", ["Business Information", "Module"]],
  ]);
  const utility = group({ shown: [], query: "utility" });
  assert.deepEqual(names(utility), [["Utility", []]]);
  assert.equal(utility[0].packageMatch, true);
});
