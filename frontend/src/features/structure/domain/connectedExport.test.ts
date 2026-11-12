/**
 * Connected Model Export — acceptance criteria, pinned.
 *
 * Run with:  npm run test:structure
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBranchIndex,
  crossBranchKey,
  csvField,
  discover,
  hierarchyBranchKey,
  instancesCsv,
  relationshipsCsv,
  resolveExport,
  scopeText,
  sdBranchKey,
  summarise,
  toCsv,
  type Definitions,
  type InstanceRecord,
  type ModelInstanceScope,
  type ScopeSelection,
} from './connectedExport.ts';

/*
 * Fixture
 *   H1 (hierarchy):  Region ─► Site ─► Site (recursive)
 *   H2 (hierarchy):  Org ─► Team            (no link to anything)
 *   S1 (support):    Asset ─[depends on]─► Risk
 *   S2 (support):    Control                 (reached only via cross rule from Risk)
 *   Cross rules:     R1  Site (H1) → Asset (S1)
 *                    R2  Risk (S1) → Control (S2)
 *                    R3  Control (S2) → Region (H1)   — closes a loop back to H1
 */
const defs: Definitions = {
  models: [
    { id: 'H1', name: 'Network', kind: 'hierarchy', status: 'active' },
    { id: 'H2', name: 'Organisation', kind: 'hierarchy', status: 'active' },
    { id: 'S1', name: 'Assets', kind: 'support', status: 'active' },
    { id: 'S2', name: 'Controls', kind: 'support', status: 'draft' },
  ],
  types: [
    { id: 'region', name: 'Region', modelId: 'H1', kind: 'hierarchy', parentId: null, isRecursive: false },
    { id: 'site', name: 'Site', modelId: 'H1', kind: 'hierarchy', parentId: 'region', isRecursive: true },
    { id: 'org', name: 'Org', modelId: 'H2', kind: 'hierarchy', parentId: null, isRecursive: false },
    { id: 'team', name: 'Team', modelId: 'H2', kind: 'hierarchy', parentId: 'org', isRecursive: false },
    { id: 'asset', name: 'Asset', modelId: 'S1', kind: 'support', parentId: null, isRecursive: false },
    { id: 'risk', name: 'Risk', modelId: 'S1', kind: 'support', parentId: null, isRecursive: false },
    { id: 'control', name: 'Control', modelId: 'S2', kind: 'support', parentId: null, isRecursive: false },
  ],
  sdRelationships: [{ id: 'sd1', modelId: 'S1', sourceTypeId: 'asset', targetTypeId: 'risk', kind: 'depends_on' }],
  crossRules: [
    { id: 'R1', name: 'Site has asset', source: { kind: 'hierarchy', modelId: 'H1', typeId: 'site' }, target: { kind: 'support', modelId: 'S1', typeId: 'asset' } },
    { id: 'R2', name: 'Risk mitigated by', source: { kind: 'support', modelId: 'S1', typeId: 'risk' }, target: { kind: 'support', modelId: 'S2', typeId: 'control' } },
    { id: 'R3', name: 'Control applies to', source: { kind: 'support', modelId: 'S2', typeId: 'control' }, target: { kind: 'hierarchy', modelId: 'H1', typeId: 'region' } },
  ],
};

const inst = (id: string, modelId: string, typeId: string, extra: Partial<InstanceRecord> = {}): InstanceRecord => ({
  id, externalId: null, modelId, typeId, name: id, description: null, status: 'active', parentId: null, ...extra,
});

const instances: InstanceRecord[] = [
  inst('north', 'H1', 'region'),
  inst('siteA', 'H1', 'site', { parentId: 'north' }),
  inst('siteA1', 'H1', 'site', { parentId: 'siteA' }), // recursive
  inst('siteB', 'H1', 'site', { parentId: 'north', status: 'retired' }),
  inst('orgX', 'H2', 'org'),
  inst('team1', 'H2', 'team', { parentId: 'orgX' }),
  inst('pump', 'S1', 'asset', { externalId: 'EXT-1', description: 'Pump, "main" line\nnorth' }),
  inst('valve', 'S1', 'asset'), // not linked to any site
  inst('flood', 'S1', 'risk'),
  inst('ctl1', 'S2', 'control'),
  inst('ctl2', 'S2', 'control'), // unconnected control
];
const crossLinks = [
  { id: 'x1', ruleId: 'R1', sourceId: 'siteA', targetId: 'pump' },
  { id: 'x2', ruleId: 'R2', sourceId: 'flood', targetId: 'ctl1' },
  { id: 'x3', ruleId: 'R3', sourceId: 'ctl1', targetId: 'north' },
];

const index = buildBranchIndex(defs);
const sel = (over: Partial<ScopeSelection> = {}): ScopeSelection => ({
  startTypeIds: new Set(['region', 'site']),
  expandedTypeIds: new Set(),
  includeAll: true,
  toggled: new Set(),
  ...over,
});
const run = (s: ScopeSelection, startModels: string[], scopes = new Map<string, ModelInstanceScope>(), activeOnly = false) => {
  const discovery = discover(index, s);
  const result = resolveExport({ index, discovery, startModelIds: new Set(startModels), startTypeIds: s.startTypeIds, scopes, activeOnly, instances, crossLinks });
  return { discovery, result, ids: new Set(result.instances.map((i) => i.id)) };
};

test('discovery: starting types propose their internal and cross-model branches, labelled by category', () => {
  const d = discover(index, sel());
  const keys = new Map(d.branches.map((b) => [b.branch.key, b]));
  assert.equal(keys.get(hierarchyBranchKey('region', 'site'))?.branch.category, 'hierarchy');
  assert.equal(keys.get(hierarchyBranchKey('site', 'site'))?.direction, 'self');
  assert.equal(keys.get(crossBranchKey('R1', 'site', 'asset'))?.branch.category, 'cross');
  // Incoming to Region from Control is offered too.
  assert.equal(keys.get(crossBranchKey('R3', 'control', 'region'))?.direction, 'incoming');
  // Not explored further: Asset's own branches are not proposed yet.
  assert.equal(keys.has(sdBranchKey('sd1')), false);
  assert.deepEqual([...d.scopeTypeIds].sort(), ['asset', 'control', 'region', 'site']);
});

test('discovery: exploring a related type offers its internal relationships and further connections', () => {
  const d = discover(index, sel({ expandedTypeIds: new Set(['asset']) }));
  const sd = d.branches.find((b) => b.branch.key === sdBranchKey('sd1'));
  assert.equal(sd?.branch.category, 'support');
  assert.equal(sd?.depth, 2);
  assert.ok(d.scopeTypeIds.has('risk'));
});

test('discovery: circular paths terminate and shared types are listed once', () => {
  const d = discover(index, sel({ expandedTypeIds: new Set(['asset', 'risk', 'control']) }));
  const keys = d.branches.map((b) => b.branch.key);
  assert.equal(new Set(keys).size, keys.length, 'each branch once');
  const related = d.related.map((r) => r.typeId);
  assert.equal(new Set(related).size, related.length, 'each related type once');
  // Breadth first: Control (via R3) is explored before Asset, so Risk is first reached through
  // Control (R2); Asset→Risk (sd1) then meets a type already in scope and stops there.
  const sd1 = d.branches.find((b) => b.branch.key === sdBranchKey('sd1'));
  assert.equal(sd1?.closesLoop, true);
  assert.equal(sd1?.included, true, 'a loop-closing branch is still exported between in-scope types');
  const control = d.related.find((r) => r.typeId === 'control');
  assert.equal(control?.viaBranchKeys.length, 2, 'Control is reachable by two paths');
});

test('AC: two starting models, including unconnected instances, export together under their instance scopes', () => {
  const s = sel({ startTypeIds: new Set(['region', 'site', 'org', 'team']) });
  const { ids } = run(s, ['H1', 'H2']);
  // H2 is not connected to H1 at all, yet its instances are exported.
  for (const id of ['north', 'siteA', 'siteA1', 'siteB', 'orgX', 'team1']) assert.ok(ids.has(id), id);
  // Selected instances only, for H2.
  const scopes = new Map<string, ModelInstanceScope>([['H2', { mode: 'selected', selectedIds: new Set(['orgX']) }]]);
  const second = run(s, ['H1', 'H2'], scopes);
  assert.ok(second.ids.has('orgX'));
  assert.equal(second.ids.has('team1'), false);
});

test('AC: a discovered model contributes only connected instances, unless added as a starting model', () => {
  const related = run(sel(), ['H1']);
  assert.ok(related.ids.has('pump'), 'pump is linked to siteA');
  assert.equal(related.ids.has('valve'), false, 'valve is not connected');
  assert.ok(related.ids.has('ctl1'), 'ctl1 links to north (incoming)');
  assert.equal(related.ids.has('ctl2'), false);

  const started = run(sel({ startTypeIds: new Set(['region', 'site', 'asset', 'risk']) }), ['H1', 'S1']);
  assert.ok(started.ids.has('valve'), 'as a starting model, unconnected instances are included');
});

test('AC: the three categories are identified and exported', () => {
  const s = sel({ startTypeIds: new Set(['region', 'site', 'asset', 'risk']) });
  const { result } = run(s, ['H1', 'S1']);
  const cats = new Set(result.relationships.map((r) => r.category));
  assert.deepEqual([...cats].sort(), ['cross', 'hierarchy', 'support']);
  const sd = result.relationships.filter((r) => r.category === 'support');
  // Asset→Risk is inherited from the model: pump→flood and valve→flood — even when the relationship's model id is missing.
  const noModelId = buildBranchIndex({ ...defs, sdRelationships: defs.sdRelationships.map((r) => ({ ...r, modelId: undefined as unknown as string })) });
  const d2 = discover(noModelId, s);
  const r2 = resolveExport({ index: noModelId, discovery: d2, startModelIds: new Set(['H1', 'S1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks });
  assert.equal(r2.relationships.filter((r) => r.category === 'support').length, 2);
  assert.deepEqual(sd.map((r) => `${r.sourceId}>${r.targetId}`).sort(), ['pump>flood', 'valve>flood']);
  // Hierarchy keeps the stored direction: parent → child, including the recursive one.
  const h = result.relationships.filter((r) => r.category === 'hierarchy').map((r) => `${r.sourceId}>${r.targetId}`);
  assert.ok(h.includes('siteA>siteA1'));
  assert.ok(h.includes('north>siteA'));
});

test('AC: exclusions and filters are reflected — and never leave dangling references', () => {
  // Exclude the cross branch to assets.
  const excluded = run(sel({ toggled: new Set([crossBranchKey('R1', 'site', 'asset')]) }), ['H1']);
  assert.equal(excluded.ids.has('pump'), false);
  assert.equal(excluded.result.relationships.some((r) => r.ruleId === 'R1'), false);

  // Active only drops the retired site and its parent link.
  const active = run(sel(), ['H1'], new Map(), true);
  assert.equal(active.ids.has('siteB'), false);
  assert.equal(active.result.relationships.some((r) => r.targetId === 'siteB'), false);

  // Selecting only siteA1 in H1 must not export siteA1's parent link to an unexported siteA.
  const narrow = run(sel(), ['H1'], new Map([['H1', { mode: 'selected', selectedIds: new Set(['siteA1']) }]]));
  assert.deepEqual([...narrow.ids], ['siteA1']);
  assert.equal(narrow.result.relationships.length, 0);

  for (const r of [excluded, active, narrow]) {
    for (const e of r.result.relationships) {
      assert.ok(r.ids.has(e.sourceId) && r.ids.has(e.targetId), `endpoint of ${e.id} resolves`);
    }
  }
});

test('AC: shared instances are exported once; every relationship once by ID', () => {
  const s = sel({ startTypeIds: new Set(['region', 'site', 'asset', 'risk', 'control']), expandedTypeIds: new Set() });
  const { result } = run(s, ['H1', 'S1', 'S2']);
  const ids = result.instances.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  const rels = result.relationships.map((r) => r.id);
  assert.equal(new Set(rels).size, rels.length);
});

test('stored links whose types no longer match their rule are counted, not exported', () => {
  const s = sel();
  const discovery = discover(index, s);
  // R2 allows Risk → Control; this link runs Site → Control.
  const stray = [...crossLinks, { id: 'x9', ruleId: 'R2', sourceId: 'siteA', targetId: 'ctl2' }];
  const result = resolveExport({ index, discovery, startModelIds: new Set(['H1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks: stray });
  assert.equal(result.relationships.some((r) => r.id === 'x9'), false);
  assert.equal(result.instances.some((i) => i.id === 'ctl2'), false);
  assert.equal(result.unmatchedLinks, 1);

  // The far end not loaded at all: Site is not a source R2 allows.
  const farAway = [...crossLinks, { id: 'x10', ruleId: 'R2', sourceId: 'siteA', targetId: 'not-loaded' }];
  const second = resolveExport({ index, discovery, startModelIds: new Set(['H1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks: farAway });
  assert.equal(second.unmatchedLinks, 1);
});

test('nothing is included until ticked when "include all" is off', () => {
  const d = discover(index, sel({ includeAll: false }));
  assert.equal(d.includedBranchKeys.size, 0);
  assert.deepEqual([...d.scopeTypeIds].sort(), ['region', 'site']);
  const ticked = discover(index, sel({ includeAll: false, toggled: new Set([hierarchyBranchKey('region', 'site')]) }));
  assert.deepEqual([...ticked.includedBranchKeys], [hierarchyBranchKey('region', 'site')]);
});

test('wildcard cross rules expand to concrete type pairs', () => {
  const wide = buildBranchIndex({
    ...defs,
    crossRules: [{ id: 'RW', name: 'Any site to any S1 type', source: { kind: 'hierarchy', modelId: 'H1', typeId: 'site' }, target: { kind: 'support', modelId: 'S1', typeId: null } }],
  });
  const keys = wide.touching('site').filter((b) => b.category === 'cross').map((b) => b.key).sort();
  assert.deepEqual(keys, [crossBranchKey('RW', 'site', 'asset'), crossBranchKey('RW', 'site', 'risk')]);
});

test('CSV: commas, quotation marks and line breaks are quoted; IDs resolve; counts match Scope.txt', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField(null), '');
  assert.equal(toCsv(['a', 'b'], [[1, 'x,y']]), 'a,b\r\n1,"x,y"\r\n');

  const s = sel();
  const { discovery, result } = run(s, ['H1']);
  const csv = instancesCsv(index, result);
  assert.ok(csv.startsWith('pdp_instance_id,external_id,model_id,model_name,model_kind,type_id,type_name,instance_name,description,status\r\n'));
  assert.ok(csv.includes('"Pump, ""main"" line\nnorth"'));
  assert.ok(csv.includes('EXT-1'));
  const rel = relationshipsCsv(result);
  assert.equal(rel.trim().split('\r\n').length - 1, result.relationships.length);
  assert.ok(rel.includes(',cross-model,'));
  assert.ok(rel.includes(',internal hierarchy,'));

  const summary = summarise(index, discovery, new Set(['H1']), result);
  const text = scopeText({
    profile: { name: 'Test', description: '', purpose: 'Reporting' },
    exportedAt: new Date('2026-10-30T08:00:00Z'),
    index,
    selection: s,
    discovery,
    startModelIds: new Set(['H1']),
    allTypesByModel: new Map([['H1', true]]),
    scopes: new Map(),
    activeOnly: false,
    modelActiveOnly: false,
    result,
    summary,
  });
  assert.ok(text.includes(`Instances.csv: ${result.instances.length} rows`));
  assert.ok(text.includes(`Relationships.csv: ${result.relationships.length} rows`));
  assert.ok(text.includes('may still exist in PDP'));
  assert.ok(text.includes('not evidence of a data quality pass'));
  assert.ok(text.includes('Exported at (UTC): 2026-10-30T08:00:00.000Z'));
  assert.equal(summary.totals.instances, result.instances.length);
  assert.equal(summary.byModel[0].role, 'starting');
});

test('Support Domain is inherited from the model: every source instance to every target instance', () => {
  const s = sel({ startTypeIds: new Set(['asset']) });
  const discovery = discover(index, s);
  const result = resolveExport({ index, discovery, startModelIds: new Set(['S1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks: [] });
  const sd = result.relationships.filter((r) => r.category === 'support');
  assert.deepEqual(sd.map((r) => [r.id, r.sourceId, r.targetId]).sort(), [['sd:sd1:pump:flood', 'pump', 'flood'], ['sd:sd1:valve:flood', 'valve', 'flood']]);
  assert.ok(result.instances.some((i) => i.id === 'flood'), 'the related Risk comes along through the inherited relationship');

  // Excluding the branch drops the inherited relationships and the instance they brought.
  const excluded = resolveExport({ index, discovery: discover(index, { ...s, toggled: new Set([sdBranchKey('sd1')]) }), startModelIds: new Set(['S1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks: [] });
  assert.equal(excluded.relationships.length, 0);
  assert.equal(excluded.instances.some((i) => i.id === 'flood'), false);

  // Only selected instances: only theirs.
  const narrow = resolveExport({ index, discovery, startModelIds: new Set(['S1']), startTypeIds: s.startTypeIds, scopes: new Map([['S1', { mode: 'selected', selectedIds: new Set(['pump']) }]]), activeOnly: false, instances, crossLinks: [] });
  assert.deepEqual(narrow.relationships.map((r) => r.id), ['sd:sd1:pump:flood']);
});

test('Scope.txt keeps one kind of line break, even for a description typed over several lines', () => {
  const s = sel();
  const discovery = discover(index, s);
  const result = resolveExport({ index, discovery, startModelIds: new Set(['H1']), startTypeIds: s.startTypeIds, scopes: new Map(), activeOnly: false, instances, crossLinks });
  const summary = summarise(index, discovery, new Set(['H1']), result);
  const text = scopeText({
    profile: { name: 'P', description: 'Line one\nLine two', purpose: '' },
    exportedAt: new Date('2026-10-30T10:00:00Z'),
    index, selection: s, discovery, startModelIds: new Set(['H1']), allTypesByModel: new Map([['H1', false]]),
    scopes: new Map(), activeOnly: false, modelActiveOnly: false, result, summary,
  });
  assert.equal(/[^\r]\n/.test(text), false, 'no bare line feed');
  assert.ok(text.includes('Description: Line one\r\n  Line two'));
  assert.ok(text.includes('Internal Support Domain relationships are inherited from the model'));
});
