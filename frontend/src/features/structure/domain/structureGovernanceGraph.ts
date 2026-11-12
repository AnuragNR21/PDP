/**
 * The structure governance graph, as the browser sees it.
 *
 * The graph is Structure's: every node instance, every governed value, and every
 * relationship Structure asserts between them. Consumers such as the Impact
 * workspace only read it, which is why these types live under `structure/`.
 */

/**
 * The words the governance graph is made of, in one place.
 *
 * A *kind* is a wire value: the server writes it into every item and edge, and
 * a saved diagram keeps it in its rows. Typed as a literal at each use it
 * silently drifts — `"support_domain"` becomes `"support-domain"` in one
 * comparison and the only symptom is a line missing from a picture, which
 * nobody reads as a bug. These objects are the one spelling; the backend's
 * `features/structure/domain/governance_graph_kinds.py` holds the same three strings on its
 * side, and the two are a contract.
 */
export const GOVERNANCE_ITEM_KIND = {
  /** A whole hierarchy model, not a node inside one. */
  HIERARCHY_MODEL: "HIERARCHY_MODEL",
  /** A node instance, which may be a property node. */
  HIERARCHY_NODE: "HIERARCHY_NODE",
  /** A governed value: one Support Domain element instance. */
  SUPPORT_DOMAIN_ELEMENT: "SUPPORT_DOMAIN_ELEMENT",
} as const;

export type GovernanceItemKind = (typeof GOVERNANCE_ITEM_KIND)[keyof typeof GOVERNANCE_ITEM_KIND];

export const GOVERNANCE_EDGE_KIND = {
  /** Parent to child inside one model, and a model to the roots it holds. */
  HIERARCHY: "hierarchy",
  /** A node instance governed by an element instance. */
  CROSS_MODEL: "cross_model",
  /**
   * Read down from a relationship authored between element *types*, so it is
   * never an asserted fact about these two values. Always `asserted: false`.
   */
  SUPPORT_DOMAIN: "support_domain",
} as const;

export type GovernanceEdgeKind = (typeof GOVERNANCE_EDGE_KIND)[keyof typeof GOVERNANCE_EDGE_KIND];

/** One thing that can sit on the canvas, exactly as the server describes it. */
export type GovernanceItem = {
  item_id: string;
  item_kind: GovernanceItemKind;
  name: string;
  status: string;
  model_id: string;
  model_name: string;
  type_name: string | null;
  is_property: boolean;
  parent_id: string | null;
};

/**
 * One relationship between two items.
 *
 * `asserted` is false for a relationship the database holds between element
 * *types* and that is only being read down onto their instances. It is drawn
 * differently and must never be presented as something governance stated.
 */
export type GovernanceEdge = {
  edge_id: string;
  edge_kind: GovernanceEdgeKind;
  source_id: string;
  target_id: string;
  label: string;
  governance_role: string | null;
  asserted: boolean;
};
