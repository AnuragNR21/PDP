/**
 * Connected Model Export — the rules, as plain functions over plain data.
 *
 * Nothing here talks to the server or to React: definitions and instances
 * arrive already loaded, and everything the preview shows and the download
 * contains is computed here from them. The preview and the ZIP call the same
 * functions on the same inputs, so they cannot disagree.
 *
 * The export is read-only. It reads model definitions (types and the
 * relationships allowed between them) and Structure instances; it never
 * writes either.
 *
 * Three kinds of relationship exist between instances, and they are always
 * told apart:
 *   • internal hierarchy       — a node's stored parent (parent → child), in one hierarchy model;
 *   • internal Support Domain  — inherited from the model: wherever a Support Domain model relates
 *                                element type A to B, every A instance relates to every B instance;
 *   • cross-model              — a stored link between two instances, governed by a cross-model rule.
 *
 * That is PDP's own rule (Model level governs, Structure level inherits):
 * hierarchy and Support Domain relationships follow the model, cross-model
 * relationships are the instance links chosen from what the model offers.
 * Links drawn on the SWS diagram (support_domain_element_instance_relationship_diagram_edges) are diagram-only and
 * are not part of the export.
 *
 * Run the tests with:  npm run test:structure
 */

export type ExportModelKind = 'hierarchy' | 'support';
export type BranchCategory = 'hierarchy' | 'support' | 'cross';

export const CATEGORY_LABEL: Record<BranchCategory, string> = {
  hierarchy: 'internal hierarchy',
  support: 'internal Support Domain',
  cross: 'cross-model',
};

export type ModelDef = { id: string; name: string; kind: ExportModelKind; status: string };

export type TypeDef = {
  id: string;
  name: string;
  modelId: string;
  kind: ExportModelKind;
  /** Hierarchy node types only: the parent node type. */
  parentId: string | null;
  /** Hierarchy node types only: an instance may sit beneath an instance of its own type. */
  isRecursive: boolean;
};

export type SdRelationshipDef = { id: string; modelId: string; sourceTypeId: string; targetTypeId: string; kind: string };

export type CrossRuleEnd = { kind: ExportModelKind; modelId: string | null; typeId: string | null };
export type CrossRuleDef = { id: string; name: string; source: CrossRuleEnd; target: CrossRuleEnd };

export type Definitions = {
  models: ModelDef[];
  types: TypeDef[];
  sdRelationships: SdRelationshipDef[];
  crossRules: CrossRuleDef[];
};

/** One relationship between two types, as the model defines it: a branch the export can follow. */
export type Branch = {
  key: string;
  category: BranchCategory;
  ruleId: string;
  ruleName: string;
  sourceTypeId: string;
  targetTypeId: string;
};

// ── Branch index ─────────────────────────────────────────────────────────────

export type BranchIndex = {
  models: Map<string, ModelDef>;
  types: Map<string, TypeDef>;
  sdRelationships: Map<string, SdRelationshipDef>;
  crossRules: Map<string, CrossRuleDef>;
  /** Every branch with this type at either end. Computed once per type, then cached. */
  touching: (typeId: string) => Branch[];
};

export function hierarchyBranchKey(parentTypeId: string, childTypeId: string) {
  return `H:${parentTypeId}>${childTypeId}`;
}
export function sdBranchKey(relationshipId: string) {
  return `S:${relationshipId}`;
}
export function crossBranchKey(ruleId: string, sourceTypeId: string, targetTypeId: string) {
  return `X:${ruleId}:${sourceTypeId}>${targetTypeId}`;
}

export function kindLabel(kind: string) {
  const spaced = kind.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : kind;
}

export function buildBranchIndex(defs: Definitions): BranchIndex {
  const models = new Map(defs.models.map((m) => [m.id, m]));
  const types = new Map(defs.types.map((t) => [t.id, t]));
  const sdRelationships = new Map(defs.sdRelationships.map((r) => [r.id, r]));
  const crossRules = new Map(defs.crossRules.map((r) => [r.id, r]));

  const childrenOf = new Map<string, TypeDef[]>();
  const typesOfModel = new Map<string, TypeDef[]>();
  const typesOfKind = new Map<ExportModelKind, TypeDef[]>();
  for (const t of defs.types) {
    if (t.kind === 'hierarchy' && t.parentId && types.has(t.parentId)) childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t]);
    typesOfModel.set(t.modelId, [...(typesOfModel.get(t.modelId) ?? []), t]);
    typesOfKind.set(t.kind, [...(typesOfKind.get(t.kind) ?? []), t]);
  }
  const sdByType = new Map<string, SdRelationshipDef[]>();
  for (const r of defs.sdRelationships) {
    sdByType.set(r.sourceTypeId, [...(sdByType.get(r.sourceTypeId) ?? []), r]);
    if (r.targetTypeId !== r.sourceTypeId) sdByType.set(r.targetTypeId, [...(sdByType.get(r.targetTypeId) ?? []), r]);
  }

  /** The concrete types a cross-model rule end stands for: one type, every type of a model, or every type of a kind. */
  const endTypes = (end: CrossRuleEnd): TypeDef[] =>
    end.typeId ? (types.has(end.typeId) ? [types.get(end.typeId)!] : []) : end.modelId ? (typesOfModel.get(end.modelId) ?? []) : (typesOfKind.get(end.kind) ?? []);
  const endHas = (end: CrossRuleEnd, t: TypeDef) =>
    t.kind === end.kind && (end.typeId ? end.typeId === t.id : end.modelId ? end.modelId === t.modelId : true);

  const cache = new Map<string, Branch[]>();
  const touching = (typeId: string): Branch[] => {
    const cached = cache.get(typeId);
    if (cached) return cached;
    const t = types.get(typeId);
    const out: Branch[] = [];
    if (t) {
      const name = (id: string) => types.get(id)?.name ?? id;
      if (t.kind === 'hierarchy') {
        if (t.parentId && types.has(t.parentId)) {
          out.push({ key: hierarchyBranchKey(t.parentId, t.id), category: 'hierarchy', ruleId: `${t.parentId}>${t.id}`, ruleName: `Parent of (${name(t.parentId)} → ${t.name})`, sourceTypeId: t.parentId, targetTypeId: t.id });
        }
        for (const child of childrenOf.get(t.id) ?? []) {
          if (child.id === t.id) continue;
          out.push({ key: hierarchyBranchKey(t.id, child.id), category: 'hierarchy', ruleId: `${t.id}>${child.id}`, ruleName: `Parent of (${t.name} → ${child.name})`, sourceTypeId: t.id, targetTypeId: child.id });
        }
        if (t.isRecursive) {
          out.push({ key: hierarchyBranchKey(t.id, t.id), category: 'hierarchy', ruleId: `${t.id}>${t.id}`, ruleName: `Parent of (${t.name} → ${t.name}, recursive)`, sourceTypeId: t.id, targetTypeId: t.id });
        }
      } else {
        for (const r of sdByType.get(t.id) ?? []) {
          out.push({ key: sdBranchKey(r.id), category: 'support', ruleId: r.id, ruleName: kindLabel(r.kind), sourceTypeId: r.sourceTypeId, targetTypeId: r.targetTypeId });
        }
      }
      for (const rule of defs.crossRules) {
        if (endHas(rule.source, t)) {
          for (const other of endTypes(rule.target)) {
            out.push({ key: crossBranchKey(rule.id, t.id, other.id), category: 'cross', ruleId: rule.id, ruleName: rule.name, sourceTypeId: t.id, targetTypeId: other.id });
          }
        }
        if (endHas(rule.target, t)) {
          for (const other of endTypes(rule.source)) {
            if (other.id === t.id && endHas(rule.source, t)) continue; // already added from the source side
            out.push({ key: crossBranchKey(rule.id, other.id, t.id), category: 'cross', ruleId: rule.id, ruleName: rule.name, sourceTypeId: other.id, targetTypeId: t.id });
          }
        }
      }
    }
    // One entry per key.
    const seen = new Set<string>();
    const unique = out.filter((b) => (seen.has(b.key) ? false : (seen.add(b.key), true)));
    cache.set(typeId, unique);
    return unique;
  };

  return { models, types, sdRelationships, crossRules, touching };
}

// ── Discovery (type level) ───────────────────────────────────────────────────

export type ScopeSelection = {
  /** The chosen types of every starting model. */
  startTypeIds: ReadonlySet<string>;
  /** Related types the person chose to explore further (R05). */
  expandedTypeIds: ReadonlySet<string>;
  /** Include all discovered branches (true) or none until ticked (false). */
  includeAll: boolean;
  /** Branches that differ from the default: excluded when includeAll, included otherwise. */
  toggled: ReadonlySet<string>;
};

export type DiscoveredBranch = {
  branch: Branch;
  /** The in-scope type it was found from. */
  fromTypeId: string;
  /** The type at the other end (the same type for a recursive branch). */
  otherTypeId: string;
  /** Relative to `fromTypeId`. */
  direction: 'outgoing' | 'incoming' | 'self';
  /** Steps from a starting type: 1 for a branch found from a starting type. */
  depth: number;
  included: boolean;
  /** The other end was already in scope: following it adds nothing and goes no further. */
  closesLoop: boolean;
};

export type RelatedType = {
  typeId: string;
  depth: number;
  /** Included branches it is reached through (more than one when found by several paths). */
  viaBranchKeys: string[];
  expanded: boolean;
};

export type Discovery = {
  branches: DiscoveredBranch[];
  /** Starting types plus every type reached through an included branch. */
  scopeTypeIds: Set<string>;
  related: RelatedType[];
  includedBranchKeys: Set<string>;
};

export function isBranchIncluded(sel: Pick<ScopeSelection, 'includeAll' | 'toggled'>, key: string) {
  return sel.includeAll !== sel.toggled.has(key);
}

export function discover(index: BranchIndex, sel: ScopeSelection): Discovery {
  const scope = new Set<string>();
  const depthOf = new Map<string, number>();
  for (const id of sel.startTypeIds) {
    if (!index.types.has(id)) continue;
    scope.add(id);
    depthOf.set(id, 0);
  }
  const explored = new Set<string>();
  const queue: string[] = [...scope];
  const discovered = new Map<string, DiscoveredBranch>();
  const via = new Map<string, Set<string>>();

  // Breadth first, so every type is reached by its shortest path and each is explored once:
  // circular paths end where they meet a type already in scope.
  while (queue.length > 0) {
    const typeId = queue.shift()!;
    if (explored.has(typeId)) continue;
    explored.add(typeId);
    const depth = depthOf.get(typeId) ?? 0;
    for (const branch of index.touching(typeId)) {
      const self = branch.sourceTypeId === branch.targetTypeId;
      const otherTypeId = self ? typeId : branch.sourceTypeId === typeId ? branch.targetTypeId : branch.sourceTypeId;
      const included = isBranchIncluded(sel, branch.key);
      if (included && !self) via.set(otherTypeId, (via.get(otherTypeId) ?? new Set()).add(branch.key));
      if (discovered.has(branch.key)) continue;
      const closesLoop = scope.has(otherTypeId);
      discovered.set(branch.key, {
        branch,
        fromTypeId: typeId,
        otherTypeId,
        direction: self ? 'self' : branch.sourceTypeId === typeId ? 'outgoing' : 'incoming',
        depth: depth + 1,
        included,
        closesLoop,
      });
      if (!included || closesLoop) continue;
      scope.add(otherTypeId);
      depthOf.set(otherTypeId, depth + 1);
      if (sel.expandedTypeIds.has(otherTypeId)) queue.push(otherTypeId);
    }
  }

  const related: RelatedType[] = [...scope]
    .filter((id) => !sel.startTypeIds.has(id))
    .map((id) => ({ typeId: id, depth: depthOf.get(id) ?? 1, viaBranchKeys: [...(via.get(id) ?? [])], expanded: explored.has(id) }))
    .sort((a, b) => a.depth - b.depth);
  const branches = [...discovered.values()];
  return {
    branches,
    scopeTypeIds: scope,
    related,
    includedBranchKeys: new Set(branches.filter((b) => b.included).map((b) => b.branch.key)),
  };
}

// ── Instances (R06, R07) ─────────────────────────────────────────────────────

export type InstanceRecord = {
  id: string;
  externalId: string | null;
  modelId: string;
  typeId: string;
  name: string;
  description: string | null;
  status: string;
  /** Hierarchy node instances only: the stored parent. */
  parentId: string | null;
};

export type CrossLinkRecord = { id: string; ruleId: string; sourceId: string; targetId: string };


export type ModelInstanceScope = {
  /** All instances of the chosen types, or only the ticked ones. */
  mode: 'all' | 'selected';
  selectedIds: ReadonlySet<string>;
};

export type ResolveInput = {
  index: BranchIndex;
  discovery: Discovery;
  startModelIds: ReadonlySet<string>;
  startTypeIds: ReadonlySet<string>;
  scopes: ReadonlyMap<string, ModelInstanceScope>;
  activeOnly: boolean;
  instances: InstanceRecord[];
  crossLinks: CrossLinkRecord[];
};

export type ExportRelationship = {
  id: string;
  ruleId: string;
  ruleName: string;
  category: BranchCategory;
  branchKey: string;
  sourceId: string;
  targetId: string;
};

export type ExportResult = {
  instances: InstanceRecord[];
  relationships: ExportRelationship[];
  /**
   * Stored relationships touching an exported instance that match no
   * relationship the models define — a cross-model link whose instance types
   * no longer fit its rule, or a parent whose node type is not the defined
   * parent type. They
   * follow no defined path, so they are not exported.
   */
  unmatchedLinks: number;
};

export function instanceAdmitted(scope: ModelInstanceScope | undefined, id: string) {
  return !scope || scope.mode === 'all' || scope.selectedIds.has(id);
}

/**
 * Which instances and relationships the export holds.
 *
 * Starting types contribute their instances as their model's instance scope
 * says. Every other type in scope contributes only instances connected —
 * through included branches, along actual instance relationships — to an
 * instance already in the export. A relationship is exported only when both
 * of its ends are, so nothing in Relationships.csv points outside
 * Instances.csv. Each instance and relationship appears once, by ID.
 */
export function resolveExport(input: ResolveInput): ExportResult {
  const { index, discovery, activeOnly } = input;
  const scopeTypes = discovery.scopeTypeIds;
  const included = discovery.includedBranchKeys;
  const passes = (i: InstanceRecord) => !activeOnly || i.status === 'active';

  const byId = new Map<string, InstanceRecord>();
  for (const i of input.instances) if (!byId.has(i.id)) byId.set(i.id, i);

  // Starting types: instance scope. Other in-scope types: anything that passes, if connected.
  const isSeed = (i: InstanceRecord) =>
    input.startTypeIds.has(i.typeId) && input.startModelIds.has(i.modelId) && instanceAdmitted(input.scopes.get(i.modelId), i.id);
  const candidate = (i: InstanceRecord | undefined): i is InstanceRecord => {
    if (!i || !scopeTypes.has(i.typeId) || !passes(i)) return false;
    return input.startTypeIds.has(i.typeId) && input.startModelIds.has(i.modelId) ? isSeed(i) : true;
  };

  // Instance-level edges along included branches, between candidates only.
  const edges = new Map<string, ExportRelationship>();
  const add = (e: ExportRelationship) => {
    if (!edges.has(e.id)) edges.set(e.id, e);
  };
  for (const child of byId.values()) {
    if (!child.parentId) continue;
    const parent = byId.get(child.parentId);
    if (!candidate(parent) || !candidate(child)) continue;
    const key = hierarchyBranchKey(parent.typeId, child.typeId);
    if (!included.has(key)) continue;
    const pt = index.types.get(parent.typeId);
    const ct = index.types.get(child.typeId);
    add({ id: `hierarchy:${child.id}`, ruleId: `${parent.typeId}>${child.typeId}`, ruleName: `Parent of (${pt?.name ?? parent.typeId} → ${ct?.name ?? child.typeId}${parent.typeId === child.typeId ? ', recursive' : ''})`, category: 'hierarchy', branchKey: key, sourceId: parent.id, targetId: child.id });
  }
  // Support Domain: inherited from the model — every candidate instance of the
  // source type relates to every candidate instance of the target type.
  const byType = new Map<string, InstanceRecord[]>();
  for (const i of byId.values()) {
    if (!candidate(i)) continue;
    const list = byType.get(i.typeId);
    if (list) list.push(i);
    else byType.set(i.typeId, [i]);
  }
  for (const rel of index.sdRelationships.values()) {
    const key = sdBranchKey(rel.id);
    if (!included.has(key)) continue;
    // Element types belong to exactly one model, so the type alone places the instance.
    const sources = byType.get(rel.sourceTypeId) ?? [];
    const targets = byType.get(rel.targetTypeId) ?? [];
    const ruleName = kindLabel(rel.kind);
    for (const s of sources) {
      for (const t of targets) {
        if (s.id === t.id) continue;
        add({ id: `sd:${rel.id}:${s.id}:${t.id}`, ruleId: rel.id, ruleName, category: 'support', branchKey: key, sourceId: s.id, targetId: t.id });
      }
    }
  }
  for (const link of input.crossLinks) {
    const s = byId.get(link.sourceId);
    const t = byId.get(link.targetId);
    if (!candidate(s) || !candidate(t)) continue;
    const key = crossBranchKey(link.ruleId, s.typeId, t.typeId);
    if (!included.has(key)) continue;
    add({ id: link.id, ruleId: link.ruleId, ruleName: index.crossRules.get(link.ruleId)?.name ?? link.ruleId, category: 'cross', branchKey: key, sourceId: s.id, targetId: t.id });
  }

  // Walk out from the seeds; the visited set ends every circular path.
  const adjacency = new Map<string, string[]>();
  const connect = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const e of edges.values()) {
    connect(e.sourceId, e.targetId);
    connect(e.targetId, e.sourceId);
  }
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const i of byId.values()) {
    if (candidate(i) && isSeed(i)) {
      reached.add(i.id);
      queue.push(i.id);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of adjacency.get(queue[head]) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }

  const instances = [...byId.values()].filter((i) => reached.has(i.id));
  const relationships = [...edges.values()].filter((e) => reached.has(e.sourceId) && reached.has(e.targetId));
  const definedKeys = new Map<string, Set<string>>();
  const isDefined = (typeId: string, key: string) => {
    let keys = definedKeys.get(typeId);
    if (!keys) definedKeys.set(typeId, (keys = new Set(index.touching(typeId).map((b) => b.key))));
    return keys.has(key);
  };
  // The far end may sit in a model that is not loaded: then judge the exported end against its side of the rule.
  const fitsEnd = (end: CrossRuleEnd, typeId: string) => {
    const t = index.types.get(typeId);
    return Boolean(t) && t!.kind === end.kind && (end.typeId ? end.typeId === typeId : end.modelId ? end.modelId === t!.modelId : true);
  };
  let unmatchedLinks = 0;
  for (const link of input.crossLinks) {
    if (!reached.has(link.sourceId) && !reached.has(link.targetId)) continue;
    const s = byId.get(link.sourceId);
    const t = byId.get(link.targetId);
    const rule = index.crossRules.get(link.ruleId);
    const ok =
      s && t
        ? isDefined(s.typeId, crossBranchKey(link.ruleId, s.typeId, t.typeId))
        : Boolean(rule) && (!s || fitsEnd(rule!.source, s.typeId)) && (!t || fitsEnd(rule!.target, t.typeId));
    if (!ok) unmatchedLinks += 1;
  }
  for (const child of byId.values()) {
    if (!child.parentId || (!reached.has(child.id) && !reached.has(child.parentId))) continue;
    const parent = byId.get(child.parentId);
    if (!parent) continue;
    if (!isDefined(child.typeId, hierarchyBranchKey(parent.typeId, child.typeId))) unmatchedLinks += 1;
  }
  return { instances, relationships, unmatchedLinks };
}

// ── Summary (R08) ────────────────────────────────────────────────────────────

export type ModelSummaryRow = {
  modelId: string;
  name: string;
  kind: ExportModelKind;
  role: 'starting' | 'related';
  types: number;
  instances: number;
  relationships: number;
};

export type ExportSummary = {
  byModel: ModelSummaryRow[];
  totals: { models: number; types: number; instances: number; relationships: number; byCategory: Record<BranchCategory, number> };
};

export function summarise(index: BranchIndex, discovery: Discovery, startModelIds: ReadonlySet<string>, result: ExportResult): ExportSummary {
  const modelOf = new Map(result.instances.map((i) => [i.id, i.modelId]));
  const rows = new Map<string, ModelSummaryRow>();
  const row = (modelId: string) => {
    let r = rows.get(modelId);
    if (!r) {
      const m = index.models.get(modelId);
      r = { modelId, name: m?.name ?? modelId, kind: m?.kind ?? 'hierarchy', role: startModelIds.has(modelId) ? 'starting' : 'related', types: 0, instances: 0, relationships: 0 };
      rows.set(modelId, r);
    }
    return r;
  };
  for (const id of startModelIds) row(id);
  for (const typeId of discovery.scopeTypeIds) {
    const t = index.types.get(typeId);
    if (t) row(t.modelId).types += 1;
  }
  for (const i of result.instances) row(i.modelId).instances += 1;
  const byCategory: Record<BranchCategory, number> = { hierarchy: 0, support: 0, cross: 0 };
  for (const e of result.relationships) {
    byCategory[e.category] += 1;
    const a = modelOf.get(e.sourceId);
    const b = modelOf.get(e.targetId);
    if (a) row(a).relationships += 1;
    if (b && b !== a) row(b).relationships += 1;
  }
  const byModel = [...rows.values()].sort((x, y) => (x.role === y.role ? x.name.localeCompare(y.name) : x.role === 'starting' ? -1 : 1));
  return {
    byModel,
    totals: {
      models: byModel.length,
      types: discovery.scopeTypeIds.size,
      instances: result.instances.length,
      relationships: result.relationships.length,
      byCategory,
    },
  };
}

// ── Files (R09) ──────────────────────────────────────────────────────────────

/** RFC 4180: quote a field holding a comma, quotation mark or line break; double inner quotes. */
export function csvField(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export const INSTANCE_COLUMNS = [
  'pdp_instance_id', 'external_id', 'model_id', 'model_name', 'model_kind',
  'type_id', 'type_name', 'instance_name', 'description', 'status',
];
export const RELATIONSHIP_COLUMNS = [
  'relationship_id', 'relationship_rule_id', 'relationship_rule_name', 'category',
  'source_instance_id', 'target_instance_id', 'source_model_id', 'target_model_id',
];

export const MODEL_KIND_LABEL: Record<ExportModelKind, string> = { hierarchy: 'Hierarchy', support: 'Support Domain' };

export function instancesCsv(index: BranchIndex, result: ExportResult) {
  return toCsv(
    INSTANCE_COLUMNS,
    result.instances.map((i) => {
      const m = index.models.get(i.modelId);
      return [i.id, i.externalId, i.modelId, m?.name ?? '', m ? MODEL_KIND_LABEL[m.kind] : '', i.typeId, index.types.get(i.typeId)?.name ?? '', i.name, i.description, i.status];
    }),
  );
}

export function relationshipsCsv(result: ExportResult) {
  const modelOf = new Map(result.instances.map((i) => [i.id, i.modelId]));
  return toCsv(
    RELATIONSHIP_COLUMNS,
    result.relationships.map((e) => [e.id, e.ruleId, e.ruleName, CATEGORY_LABEL[e.category], e.sourceId, e.targetId, modelOf.get(e.sourceId), modelOf.get(e.targetId)]),
  );
}

export type ScopeTextInput = {
  profile: { name: string; description: string; purpose: string };
  exportedAt: Date;
  index: BranchIndex;
  selection: ScopeSelection;
  discovery: Discovery;
  startModelIds: ReadonlySet<string>;
  /** Per starting model: every type chosen, or a subset. */
  allTypesByModel: ReadonlyMap<string, boolean>;
  scopes: ReadonlyMap<string, ModelInstanceScope>;
  activeOnly: boolean;
  modelActiveOnly: boolean;
  result: ExportResult;
  summary: ExportSummary;
};

function offsetLabel(date: Date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function localStamp(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function scopeText(input: ScopeTextInput): string {
  const { index, discovery, selection } = input;
  const typeLabel = (id: string) => {
    const t = index.types.get(id);
    return t ? `${t.name} (${index.models.get(t.modelId)?.name ?? t.modelId})` : id;
  };
  const branchLine = (b: Branch) =>
    b.sourceTypeId === b.targetTypeId
      ? `${typeLabel(b.sourceTypeId)} —[${b.ruleName}]→ itself  · ${CATEGORY_LABEL[b.category]}`
      : `${typeLabel(b.sourceTypeId)} —[${b.ruleName}]→ ${typeLabel(b.targetTypeId)}  · ${CATEGORY_LABEL[b.category]}`;
  let timeZone = 'local';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    // keep 'local'
  }

  const lines: string[] = [];
  const section = (title: string) => lines.push('', title, '-'.repeat(title.length));
  lines.push('PDP Connected Model Export — Scope');
  lines.push('==================================');
  section('Profile');
  // A field typed over several lines keeps them, indented, with the file's own line breaks.
  const field = (value: string, empty: string) => value.trim().replace(/\r\n|\r|\n/g, '\r\n  ') || empty;
  lines.push(`Name: ${field(input.profile.name, '(not named)')}`);
  lines.push(`Description: ${field(input.profile.description, '(none)')}`);
  lines.push(`Purpose: ${field(input.profile.purpose, '(none)')}`);
  section('Export');
  lines.push(`Exported at: ${localStamp(input.exportedAt)} (${timeZone}, ${offsetLabel(input.exportedAt)})`);
  lines.push(`Exported at (UTC): ${input.exportedAt.toISOString()}`);
  lines.push('Mode: read-only. Nothing in PDP was changed by this export.');

  section('Starting models');
  for (const modelId of input.startModelIds) {
    const m = index.models.get(modelId);
    const scope = input.scopes.get(modelId);
    const types = [...selection.startTypeIds].filter((id) => index.types.get(id)?.modelId === modelId);
    lines.push(`• ${m?.name ?? modelId} [${m ? MODEL_KIND_LABEL[m.kind] : '?'}] — ${modelId}`);
    lines.push(`    Types: ${input.allTypesByModel.get(modelId) ? 'all types' : 'selected types'} (${types.length}): ${types.map((id) => index.types.get(id)?.name ?? id).join(', ') || '(none)'}`);
    lines.push(`    Instances: ${!scope || scope.mode === 'all' ? 'all instances of the selected types' : `selected instances only (${scope.selectedIds.size} chosen)`}`);
  }
  const related = input.summary.byModel.filter((r) => r.role === 'related');
  section('Related models (connected instances only)');
  if (related.length === 0) lines.push('(none)');
  for (const r of related) lines.push(`• ${r.name} [${MODEL_KIND_LABEL[r.kind]}] — ${r.modelId}`);

  section('Types in scope');
  for (const typeId of discovery.scopeTypeIds) {
    const role = selection.startTypeIds.has(typeId) ? 'starting' : `related, ${selection.expandedTypeIds.has(typeId) ? 'explored further' : 'not explored further'}`;
    lines.push(`• ${typeLabel(typeId)} — ${typeId} (${role})`);
  }

  section('Relationship paths followed');
  const included = discovery.branches.filter((b) => b.included);
  if (included.length === 0) lines.push('(none)');
  for (const b of included) lines.push(`• ${branchLine(b.branch)}`);

  section('Exclusions');
  lines.push(`Discovered branches default: ${selection.includeAll ? 'include all' : 'none unless ticked'}`);
  const excluded = discovery.branches.filter((b) => !b.included);
  if (excluded.length === 0) lines.push('(no discovered branch excluded)');
  for (const b of excluded) lines.push(`• excluded: ${branchLine(b.branch)}`);

  section('Filters');
  lines.push(`Model filter: ${input.modelActiveOnly ? 'active models only' : 'all models'}`);
  lines.push(`Instance filter: ${input.activeOnly ? 'active instances only' : 'all statuses'}`);
  lines.push('Related types contribute only instances connected, along the paths above, to an exported instance.');

  section('Files');
  const t = input.summary.totals;
  lines.push(`Instances.csv: ${t.instances} rows`);
  lines.push(`Relationships.csv: ${t.relationships} rows (internal hierarchy ${t.byCategory.hierarchy}, internal Support Domain ${t.byCategory.support}, cross-model ${t.byCategory.cross})`);
  for (const r of input.summary.byModel) lines.push(`  ${r.name}: ${r.instances} instances, ${r.relationships} relationships`);
  lines.push('Every relationship_id appears once; every source_instance_id and target_instance_id resolves to a row of Instances.csv.');
  lines.push('Internal hierarchy relationships run parent → child, as stored (relationship_id is "hierarchy:" + the child instance ID,');
  lines.push('because a parent link is stored on the child).');
  lines.push('Internal Support Domain relationships are inherited from the model: where it relates element type A to B, every');
  lines.push('exported A instance relates to every exported B instance (relationship_id is "sd:" + relationship + source + target).');
  lines.push('Cross-model relationships are the stored instance links, with their own IDs and stored direction.');
  lines.push('Links drawn on the Structure Workspace diagram are diagram-only and are not part of this export.');
  if (input.result.unmatchedLinks > 0) {
    lines.push(`Not exported: ${input.result.unmatchedLinks} stored relationship(s) touching exported instances that match no relationship`);
    lines.push('the models currently define (for example a link whose rule changed after it was made); they follow no defined path.');
  }

  section('Please note');
  lines.push('• This export is a selection. Instances, relationships and models omitted from it may still exist in PDP.');
  lines.push('• Relationship rules listed here describe what the model allows. Exporting them does not mean any rule was executed,');
  lines.push('  and it is not evidence of a data quality pass.');
  return lines.join('\r\n') + '\r\n';
}

export function exportFileName(profileName: string, date: Date) {
  const slug = profileName.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'connected-model-export';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${slug}_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.zip`;
}
