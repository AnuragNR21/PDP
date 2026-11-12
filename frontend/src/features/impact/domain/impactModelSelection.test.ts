/**
 * Impact Model Selection — aligned with the Structure Workspace Model Selection:
 * Package → Model → Item, the type toggle, Active, and one search.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  elementTypeGroups,
  matchItems,
  nextSelection,
  shownPackages,
  splitModelRow,
  type PickerModel,
} from "./impactModelSelection.ts";
import type { CrossModelSelectableItem } from "../../cross-model/domain/crossModelSelection";

const item = (id: string, name: string, extra: Partial<CrossModelSelectableItem> = {}): CrossModelSelectableItem =>
  ({ id, name, level: "instance", modelKind: "HIERARCHY_MODEL", modelId: "h1", modelName: "Assets", typeId: "t", typeName: "Type", parentId: null, ...extra }) as CrossModelSelectableItem;

const packages = [
  { id: "shared-models", name: "Shared Models" },
  { id: "pkg-assess", name: "Assessment" },
];

const hierarchy: PickerModel = {
  key: "hierarchy:h1",
  id: "h1",
  name: "0001 Asset Information",
  kind: "hierarchy",
  status: "active",
  packageId: "shared-models",
  modelItem: item("model:h1", "0001 Asset Information", { typeId: "__hierarchy_model__" }),
  items: [
    item("root", "Network Asset", { parentId: "model:h1" }),
    item("sw", "Switch", { parentId: "root" }),
    item("mf", "Manufacturer", { parentId: "sw" }),
    item("tx", "Transformer", { parentId: "root" }),
  ],
};
const support: PickerModel = {
  key: "support:s1",
  id: "s1",
  name: "Asset Classification",
  kind: "support",
  status: "draft",
  packageId: "shared-models",
  items: [
    item("i2", "Overheating", { modelKind: "SUPPORT_DOMAIN_MODEL", typeId: "fm", typeName: "Failure Mode", modelId: "s1" }),
    item("i1", "Contact Wear", { modelKind: "SUPPORT_DOMAIN_MODEL", typeId: "fm", typeName: "Failure Mode", modelId: "s1" }),
  ],
  elementTypes: [
    { typeId: "at", typeName: "Asset Type" },
    { typeId: "fm", typeName: "Failure Mode" },
  ],
};
const assessment: PickerModel = {
  key: "hierarchy:h2",
  id: "h2",
  name: "01. BMP Assessment Framework",
  kind: "hierarchy",
  status: "active",
  packageId: "pkg-assess",
  items: [item("q", "Question", { modelId: "h2" })],
};
const models = [hierarchy, support, assessment];
const none = { kind: "all" as const, activeOnly: false, query: "" };

test("models are grouped by package, in package order", () => {
  const shown = shownPackages(packages, models, none);
  assert.deepEqual(shown.map((g) => [g.pkg.name, g.total, g.models.map((m) => m.model.id)]), [
    ["Shared Models", 2, ["h1", "s1"]],
    ["Assessment", 1, ["h2"]],
  ]);
  assert.ok(shown.every((g) => g.models.every((m) => m.visibleIds === null)));
});

test("an empty package still shows when nothing filters", () => {
  const shown = shownPackages([...packages, { id: "empty", name: "Empty" }], models, none);
  assert.deepEqual(shown.map((g) => g.pkg.name), ["Shared Models", "Assessment", "Empty"]);
  const filtered = shownPackages([...packages, { id: "empty", name: "Empty" }], models, { ...none, kind: "support" });
  assert.deepEqual(filtered.map((g) => g.pkg.name), ["Shared Models"]);
});

test("the type toggle and Active filter work together", () => {
  assert.deepEqual(
    shownPackages(packages, models, { ...none, kind: "hierarchy" }).flatMap((g) => g.models.map((m) => m.model.id)),
    ["h1", "h2"],
  );
  assert.deepEqual(
    shownPackages(packages, models, { ...none, activeOnly: true }).flatMap((g) => g.models.map((m) => m.model.id)),
    ["h1", "h2"],
  );
  assert.deepEqual(
    shownPackages(packages, models, { ...none, kind: "support", activeOnly: true }).flatMap((g) => g.models),
    [],
  );
});

test("search by package name shows the whole package", () => {
  const shown = shownPackages(packages, models, { ...none, query: "assess" });
  assert.deepEqual(shown.map((g) => [g.pkg.name, g.models.map((m) => [m.model.id, m.visibleIds])]), [["Assessment", [["h2", null]]]]);
});

test("search by model name shows the model with all its items", () => {
  const shown = shownPackages(packages, models, { ...none, query: "classification" });
  assert.deepEqual(shown.flatMap((g) => g.models.map((m) => [m.model.id, m.visibleIds])), [["s1", null]]);
});

test("search by item name shows the matches with their parents, not their siblings", () => {
  const shown = shownPackages(packages, models, { ...none, query: "manufact" });
  const [only] = shown.flatMap((g) => g.models);
  assert.equal(only.model.id, "h1");
  assert.deepEqual([...only.matchedIds], ["mf"]);
  assert.deepEqual([...(only.visibleIds ?? [])].sort(), ["mf", "root", "sw"]);
  assert.ok(!only.visibleIds?.has("tx"));
});

test("search keeps the type toggle", () => {
  assert.deepEqual(shownPackages(packages, models, { kind: "support", activeOnly: false, query: "manufact" }), []);
});

test("matching survives a parent loop", () => {
  const looped: PickerModel = { ...hierarchy, items: [item("a", "Alpha", { parentId: "b" }), item("b", "Beta", { parentId: "a" })] };
  assert.deepEqual([...matchItems(looped, "alpha").visibleIds].sort(), ["a", "b"]);
});

test("the model row is split from the items", () => {
  const { modelItem, items } = splitModelRow([hierarchy.modelItem!, ...hierarchy.items], "__hierarchy_model__");
  assert.equal(modelItem?.id, "model:h1");
  assert.equal(items.length, 4);
});

test("element types keep the model's order, list types without instances, and sort instances", () => {
  assert.deepEqual(
    elementTypeGroups(support).map((g) => [g.typeName, g.items.map((i) => i.name)]),
    [["Asset Type", []], ["Failure Mode", ["Contact Wear", "Overheating"]]],
  );
});

test("a click picks one; Ctrl/⌘ adds and removes", () => {
  const a = item("a", "A");
  const b = item("b", "B");
  assert.deepEqual(nextSelection([], a, false), [a]);
  assert.deepEqual(nextSelection([a], b, false), [b]);
  assert.deepEqual(nextSelection([a], a, false), []);
  assert.deepEqual(nextSelection([a], b, true), [a, b]);
  assert.deepEqual(nextSelection([a, b], a, true), [b]);
});
