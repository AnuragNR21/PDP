import assert from "node:assert/strict";
import test from "node:test";
import { anchorCandidates, currentExtensionLink, defaultAnchor, EXTENSION_LINK_NAME, rootOf } from "./extensionLink.ts";

const base = [
  { id: "is", parentNodeId: null, name: "Information System", sortOrder: 0 },
  { id: "pl", parentNodeId: "is", name: "Platform", sortOrder: 0 },
  { id: "ap", parentNodeId: "pl", name: "Application", sortOrder: 0 },
  { id: "ver", parentNodeId: "ap", name: "Version", isProperty: true, sortOrder: 0 },
  { id: "db", parentNodeId: "is", name: "Database", sortOrder: 1 },
];

test("the default anchor is the deepest inherited node type that can take children", () => {
  assert.equal(defaultAnchor(base)?.name, "Application"); // Version is a property node: nothing goes under it
  assert.equal(defaultAnchor([])?.name, undefined);
});

test("the candidates are every inherited node type but property nodes, in tree order", () => {
  assert.deepEqual(anchorCandidates(base).map(({ node, depth }) => [node.name, depth]), [
    ["Information System", 0],
    ["Platform", 1],
    ["Application", 2],
    ["Database", 1],
  ]);
});

test("the root of the extending model is its node type without a parent", () => {
  assert.equal(rootOf([{ id: "m", parentNodeId: null }, { id: "c", parentNodeId: "m" }])?.id, "m");
});

test("the link is the active Parent of from an inherited node type to the root", () => {
  const link = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: EXTENSION_LINK_NAME, status: "active",
    sourceModelType: "HIERARCHY_MODEL", sourceModelItemTypeId: "ap",
    targetModelType: "HIERARCHY_MODEL", targetModelItemTypeId: "m", ...extra,
  });
  const inherited = new Set(base.map((n) => n.id));
  assert.equal(currentExtensionLink([link("x")], inherited, "m")?.id, "x");
  assert.equal(currentExtensionLink([link("x", { status: "retired" })], inherited, "m"), null);
  assert.equal(currentExtensionLink([link("x", { name: "Governs" })], inherited, "m"), null);
  assert.equal(currentExtensionLink([link("x", { sourceModelItemTypeId: "elsewhere" })], inherited, "m"), null);
  assert.equal(currentExtensionLink([link("x", { targetModelItemTypeId: "other-root" })], inherited, "m"), null);
});
