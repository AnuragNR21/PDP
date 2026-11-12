import assert from "node:assert/strict";
import test from "node:test";

import { resultContext, resultHref, statusLabel, type SearchResult } from "./globalSearch.ts";

const result = (overrides: Partial<SearchResult>): SearchResult => ({
  id: "x", type: "node_type", type_label: "Node Type", workspace: "MWS", name: "Power Transformer", description: null,
  status: "active", model_id: "m1", model_name: "Asset Information", model_kind: "hierarchy", package: "Common Models",
  parent: null, detail: null, focus_id: "t1", session_id: null, file_id: null, snippet: null, rank: 2, match: "name",
  ...overrides,
});

test("a type opens its model with the type selected", () => {
  assert.equal(resultHref(result({})), "/model/tree-models?kind=hierarchy&model=m1&focus=t1");
});

test("a model opens the model", () => {
  assert.equal(resultHref(result({ type: "support_model", model_kind: "support", model_id: "s 1" })), "/model/tree-models?kind=support&model=s+1");
});

test("an instance opens SWS with the instance selected", () => {
  assert.equal(
    resultHref(result({ type: "node_instance", workspace: "SWS", focus_id: "n1" })),
    "/structure-workspace?kind=hierarchy&model=m1&instance=n1",
  );
});

test("rules open the Rule Workspace on the rule; a configuration on its rule", () => {
  assert.equal(resultHref(result({ type: "rule_definition", model_id: null, model_kind: null, focus_id: "r1" })), "/rules?rule=r1");
  assert.equal(resultHref(result({ type: "rule_configuration", model_id: null, model_kind: null, focus_id: "r1" })), "/rules?rule=r1");
  assert.equal(resultHref(result({ type: "dq_category", model_id: null, model_kind: null, focus_id: "Network" })), "/rules?category=Network");
});

test("Discover content opens its session at the right table, step and column", () => {
  const base = { model_id: null, model_kind: null, session_id: "sess_1", file_id: "sf_1" } as const;
  assert.equal(resultHref(result({ ...base, type: "discover_session", file_id: null })), "/discover/mapping/sess_1");
  assert.equal(resultHref(result({ ...base, type: "source_table" })), "/discover/mapping/sess_1?file=sf_1&step=import");
  assert.equal(resultHref(result({ ...base, type: "quality_finding", focus_id: "col_1" })), "/discover/mapping/sess_1?file=sf_1&step=quality&column=col_1");
  assert.equal(resultHref(result({ ...base, type: "source_column", focus_id: null })), "/discover/mapping/sess_1?file=sf_1&step=profile");
});

test("a result without enough context has no link rather than a wrong one", () => {
  assert.equal(resultHref(result({ model_id: null })), null);
  assert.equal(resultHref(result({ type: "something_new" })), null);
});

test("the context line names type, parent, model, package and workspace without repeats", () => {
  assert.equal(
    resultContext(result({ type: "node_instance", type_label: "Node Instance", workspace: "SWS", detail: "Power Transformer", parent: "Substation A", name: "TX-001" })),
    "Node Instance · Power Transformer · Substation A · Asset Information · Common Models · SWS",
  );
  assert.equal(resultContext(result({ type: "hierarchy_model", type_label: "Hierarchy Model", name: "Asset Information" })), "Hierarchy Model · Common Models · MWS");
});

test("lifecycle words", () => {
  assert.deepEqual(["draft", "active", "retired", "completed", null].map(statusLabel), ["Draft", "Active", "Archived", null, null]);
});
