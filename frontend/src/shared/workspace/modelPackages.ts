import { useSyncExternalStore } from 'react';
import { apiClient } from '../http/apiClient';
import type { ModelKind, WorkspaceModel } from './workspaceModel';

/**
 * Packages — a named container that owns models — and shared-model extension.
 *
 * The service has no notion of a package yet, so packages, a model's package,
 * its "common" flag and what it extends are kept as one organisation setting
 * (see "Shared with everyone" below) — the same on every device — with a copy
 * in this browser so the workspace opens straight away. A model nobody has
 * placed belongs to Shared Models.
 */

export type ModelPackage = { id: string; name: string };

export type PackageState = {
  packages: ModelPackage[];
  /** Model key → package id. */
  owner: Record<string, string>;
  /** Model keys marked as common models, intended for reuse. */
  common: Record<string, true>;
  /** Extending model key → common model key. */
  extends: Record<string, string>;
};

export const SHARED_PACKAGE_ID = 'shared-models';
export const SHARED_PACKAGE_NAME = 'Shared Models';

const STORAGE_KEY = 'pdp-model-packages-v1';
/** The packages as last agreed with the server — the base for merging changes made meanwhile. */
const BASE_KEY = 'pdp-model-packages-base-v1';
/** Organisation setting that holds the packages for everyone (managed here, hidden from Settings). */
export const PACKAGES_SETTING_KEY = 'mws_model_packages';
const EMPTY: PackageState = { packages: [{ id: SHARED_PACKAGE_ID, name: SHARED_PACKAGE_NAME }], owner: {}, common: {}, extends: {} };

export const modelKey = (model: Pick<WorkspaceModel, 'kind' | 'id'>) => `${model.kind}:${model.id}`;

/** Whatever is stored, keep only well-formed entries; Shared Models is always there. */
function sanitise(parsed: unknown): PackageState {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
  const value = parsed as Partial<PackageState>;
  const packages = (Array.isArray(value.packages) ? value.packages : []).filter(
    (p): p is ModelPackage => Boolean(p) && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim().length > 0,
  );
  const stringMap = (map: unknown): Record<string, string> =>
    map && typeof map === 'object' && !Array.isArray(map)
      ? Object.fromEntries(Object.entries(map as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {};
  const common =
    value.common && typeof value.common === 'object' && !Array.isArray(value.common)
      ? (Object.fromEntries(Object.entries(value.common).filter(([, v]) => v === true)) as Record<string, true>)
      : {};
  return {
    packages: packages.some((p) => p.id === SHARED_PACKAGE_ID) ? packages : [EMPTY.packages[0], ...packages],
    owner: stringMap(value.owner),
    common,
    extends: stringMap(value.extends),
  };
}

function readStored(key: string): PackageState | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: PackageState) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this visit only.
  }
}

let state: PackageState = readStored(STORAGE_KEY) ?? EMPTY;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Apply a state locally (this browser, every tab), without sending it anywhere. */
function apply(next: PackageState) {
  state = next;
  writeStored(STORAGE_KEY, next);
  notify();
}

/** A change made here: apply it, then send it to the server shortly. */
function emit(next: PackageState) {
  apply(next);
  scheduleSync(300);
}

// ── Shared with everyone, through the server ────────────────────────────────
// Packages are an organisation-wide arrangement, so they are kept in the
// organisation settings and every browser syncs with them: when the app opens,
// when the window regains focus, every 30 seconds, and just after a change here.
// Changes are merged field by field against the last state agreed with the
// server, so two people (or a phone and a desktop) changing different things
// keep both changes; the same field changed in both places keeps this browser's.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeMap<T>(base: Record<string, T>, ours: Record<string, T>, theirs: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
    const value = same(ours[key], base[key]) ? theirs[key] : ours[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function mergePackageStates(base: PackageState, ours: PackageState, theirs: PackageState): PackageState {
  const asMap = (list: ModelPackage[]) => Object.fromEntries(list.map((p) => [p.id, p.name]));
  const names = mergeMap(asMap(base.packages), asMap(ours.packages), asMap(theirs.packages));
  const order = [...theirs.packages.map((p) => p.id), ...ours.packages.map((p) => p.id)].filter((id, i, all) => all.indexOf(id) === i);
  return sanitise({
    packages: order.filter((id) => names[id] !== undefined).map((id) => ({ id, name: names[id] })),
    owner: mergeMap(base.owner, ours.owner, theirs.owner),
    common: mergeMap(base.common, ours.common, theirs.common),
    extends: mergeMap(base.extends, ours.extends, theirs.extends),
  });
}

type SettingRow = { setting_key: string; setting_value: string };
let syncing = false;
let syncAgain = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(delay: number) {
  if (typeof window === 'undefined') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncPackages(), delay);
}

/** Bring this browser and the server into step. Quiet on failure: the next sync tries again. */
export async function syncPackages(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    const response = await apiClient.get<{ items: SettingRow[] }>('/api/settings/organisation');
    const row = response.items.find((item) => item.setting_key === PACKAGES_SETTING_KEY);
    let theirs: PackageState = EMPTY;
    if (row) {
      try {
        theirs = sanitise(JSON.parse(row.setting_value));
      } catch {
        theirs = EMPTY;
      }
    }
    // A browser that has never synced treats everything it holds as its own change,
    // so packages made on it before sharing existed are added rather than lost.
    const base = readStored(BASE_KEY) ?? EMPTY;
    const merged = mergePackageStates(base, state, theirs);
    if (!row || !same(merged, theirs)) {
      await apiClient.put(`/api/settings/organisation/${PACKAGES_SETTING_KEY}`, {
        setting_value: JSON.stringify(merged),
        actor_label: 'Model Workspace — packages',
      });
    }
    writeStored(BASE_KEY, merged);
    if (!same(merged, state)) apply(merged);
  } catch {
    // Offline, or the server is unavailable: keep working here and try again later.
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(0);
    }
  }
}

if (typeof window !== 'undefined') {
  // Another tab changed the packages.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readStored(STORAGE_KEY) ?? EMPTY;
    notify();
  });
  window.addEventListener('focus', () => scheduleSync(0));
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncPackages();
  }, 30_000);
  scheduleSync(0);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The packages and every model's place in them, kept current across the app. */
export function usePackageState(): PackageState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// ── Reading ──────────────────────────────────────────────────────────────────

export function packageIdOf(s: PackageState, key: string): string {
  const id = s.owner[key];
  return id && s.packages.some((p) => p.id === id) ? id : SHARED_PACKAGE_ID;
}

export function packageNameOf(s: PackageState, key: string): string {
  const id = packageIdOf(s, key);
  return s.packages.find((p) => p.id === id)?.name ?? SHARED_PACKAGE_NAME;
}

export function isCommon(s: PackageState, key: string) {
  return Boolean(s.common[key]) && packageIdOf(s, key) === SHARED_PACKAGE_ID;
}

/** The common model this one extends, if it extends one that still qualifies. */
export function extendsOf(s: PackageState, key: string): string | null {
  const target = s.extends[key];
  return target && isCommon(s, target) ? target : null;
}

/** Packages in display order: Shared Models first, then by name. */
export function orderedPackages(s: PackageState): ModelPackage[] {
  const shared = s.packages.find((p) => p.id === SHARED_PACKAGE_ID)!;
  return [shared, ...s.packages.filter((p) => p.id !== SHARED_PACKAGE_ID).sort((a, b) => a.name.localeCompare(b.name))];
}

/** Common models a model may extend: same type, not itself, not one that extends. */
export function extensionTargets(s: PackageState, models: WorkspaceModel[], model: { kind: ModelKind; key?: string }) {
  return models.filter((m) => m.kind === model.kind && modelKey(m) !== model.key && isCommon(s, modelKey(m)));
}

// ── Changing ─────────────────────────────────────────────────────────────────

export class PackageError extends Error {}

function nameTaken(s: PackageState, name: string, exceptId?: string) {
  const wanted = name.trim().toLocaleLowerCase();
  return s.packages.some((p) => p.id !== exceptId && p.name.trim().toLocaleLowerCase() === wanted);
}

export function createPackage(name: string): ModelPackage {
  const trimmed = name.trim();
  if (!trimmed) throw new PackageError('A package needs a name.');
  if (nameTaken(state, trimmed)) throw new PackageError(`A package named “${trimmed}” already exists.`);
  const pkg = { id: `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed };
  emit({ ...state, packages: [...state.packages, pkg] });
  return pkg;
}

export function renamePackage(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new PackageError('A package needs a name.');
  if (nameTaken(state, trimmed, id)) throw new PackageError(`A package named “${trimmed}” already exists.`);
  emit({ ...state, packages: state.packages.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
}

/** A package can only go once it is empty; Shared Models never goes. */
export function deletePackage(id: string, models: WorkspaceModel[]) {
  if (id === SHARED_PACKAGE_ID) throw new PackageError('Shared Models cannot be deleted.');
  const count = models.filter((m) => packageIdOf(state, modelKey(m)) === id).length;
  if (count > 0) throw new PackageError(`Move or delete its ${count} model${count === 1 ? '' : 's'} first — a package that contains models cannot be deleted.`);
  emit({ ...state, packages: state.packages.filter((p) => p.id !== id) });
}

/** Who extends this model (by key). */
export function extendersOf(s: PackageState, key: string) {
  return Object.entries(s.extends).filter(([, target]) => target === key).map(([from]) => from);
}

export function moveModel(key: string, packageId: string) {
  if (!state.packages.some((p) => p.id === packageId)) throw new PackageError('That package no longer exists.');
  const leavingShared = packageIdOf(state, key) === SHARED_PACKAGE_ID && packageId !== SHARED_PACKAGE_ID;
  if (leavingShared && state.common[key] && extendersOf(state, key).length > 0) {
    throw new PackageError('Other models extend this common model, so it stays in Shared Models.');
  }
  const common = { ...state.common };
  // A common model lives in Shared Models; moving it out makes it an ordinary model.
  if (leavingShared) delete common[key];
  emit({ ...state, owner: { ...state.owner, [key]: packageId }, common });
}

export function setCommon(key: string, value: boolean) {
  if (value && packageIdOf(state, key) !== SHARED_PACKAGE_ID) throw new PackageError('Only a model in Shared Models can be a common model.');
  if (value && state.extends[key]) throw new PackageError('A model that extends another cannot itself be a common model.');
  if (!value && extendersOf(state, key).length > 0) throw new PackageError('Other models extend this common model.');
  const common = { ...state.common };
  if (value) common[key] = true;
  else delete common[key];
  emit({ ...state, common });
}

// ── Extension changes made here ──────────────────────────────────────────────
//
// What a model extends is told to listeners when a person changes it in this
// tab (setExtends, placeNewModel), and only then — never for a state that
// arrives from the server, which another browser has already acted on. The
// Model Workspace uses it to keep the structural link between the inherited
// content and the model's own in step.

export type ExtensionChange = { key: string; from: string | null; to: string | null };
const extensionListeners = new Set<(change: ExtensionChange) => void>();

export function onExtensionChange(listener: (change: ExtensionChange) => void): () => void {
  extensionListeners.add(listener);
  return () => extensionListeners.delete(listener);
}

function announceExtension(key: string, from: string | null, to: string | null) {
  if (from === to) return;
  for (const listener of extensionListeners) listener({ key, from, to });
}

export function setExtends(key: string, target: string | null) {
  const before = state.extends[key] ?? null;
  const next = { ...state.extends };
  if (!target) {
    delete next[key];
  } else {
    if (target === key) throw new PackageError('A model cannot extend itself.');
    if (!isCommon(state, target)) throw new PackageError('Only a common model in Shared Models can be extended.');
    if (state.common[key]) throw new PackageError('A common model cannot extend another model.');
    if (target.split(':')[0] !== key.split(':')[0]) throw new PackageError('A model can only extend a common model of the same type.');
    next[key] = target;
  }
  emit({ ...state, extends: next });
  announceExtension(key, before, target ?? null);
}

/** Place a model just created, and what it extends. */
export function placeNewModel(key: string, packageId: string, extendsKey: string | null) {
  emit({ ...state, owner: { ...state.owner, [key]: packageId }, extends: extendsKey ? { ...state.extends, [key]: extendsKey } : state.extends });
  if (extendsKey) announceExtension(key, null, extendsKey);
}
