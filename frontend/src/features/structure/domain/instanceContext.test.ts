import { test } from "node:test";
import assert from "node:assert/strict";
import { instanceContexts, uniqueById, type ContextItem } from "./instanceContext.ts";

const item = (id: string, name: string, typeId: string, parentId: string | null = null, modelId = "M"): ContextItem => ({ id, name, typeId, parentId, modelId });

const tree = [
  item("root", "Asset Information", "T0"),
  item("dev", "Device", "T1", "root"),
  item("str", "Structure", "T1", "root"),
  item("pole", "Pole", "T2", "str"),
  item("switch", "Switch", "T2", "dev"),
  item("tx", "Transformer", "T2", "dev"),
  item("m1", "Manufacturer", "P", "pole"),
  item("m2", "Manufacturer", "P", "switch"),
  item("m3", "Manufacturer", "P", "tx"),
  item("h", "Height", "P", "pole"),
];

test("instances that share a name are told apart by their owner", () => {
  const contexts = instanceContexts(tree);
  assert.equal(contexts.get("m1"), "Pole");
  assert.equal(contexts.get("m2"), "Switch");
  assert.equal(contexts.get("m3"), "Transformer");
});

test("an instance with a unique name gets no context", () => {
  const contexts = instanceContexts(tree);
  assert.equal(contexts.has("h"), false);
  assert.equal(contexts.has("pole"), false);
});

test("climbs further when the owners share a name too", () => {
  const items = [
    item("a", "North", "R"),
    item("b", "South", "R"),
    item("pa", "Pole", "A", "a"),
    item("pb", "Pole", "A", "b"),
    item("ma", "Manufacturer", "P", "pa"),
    item("mb", "Manufacturer", "P", "pb"),
  ];
  const contexts = instanceContexts(items);
  assert.equal(contexts.get("ma"), "North › Pole");
  assert.equal(contexts.get("mb"), "South › Pole");
  assert.equal(contexts.get("pa"), "North");
});

test("same name in another type or model is not a repeat; names compare case-insensitively", () => {
  const items = [item("x", "Location", "P", null, "M1"), item("y", "Location", "P", null, "M2"), item("z", "location", "Q", null, "M1")];
  assert.equal(instanceContexts(items).size, 0);
});

test("uniqueById keeps the first of a repeated id", () => {
  assert.deepEqual(uniqueById([{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "a", n: 3 }]), [{ id: "a", n: 1 }, { id: "b", n: 2 }]);
});
