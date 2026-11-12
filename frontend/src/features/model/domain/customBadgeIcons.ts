import { useSyncExternalStore } from 'react';

/**
 * Custom badge icons — organisation- or domain-specific SVG icons used in a
 * badge alongside the standard PDP icons.
 *
 * A badge that uses one stores the icon itself in its icon field, so it renders
 * the same for everyone, everywhere the badge is shown, with nothing else to
 * look up: `custom:<id>:<sanitised svg>`. The library — every icon uploaded
 * here and its name — is kept in this browser, and also learns any custom icon
 * it finds already in use on a badge.
 *
 * Every SVG is cleaned on the way in AND every time it is drawn (badge values
 * come from the database), keeping only plain drawing elements and attributes:
 * no scripts, event handlers, external references, embedded HTML or images.
 */

export const CUSTOM_ICON_PREFIX = 'custom:';
export const MAX_ICON_FILE_BYTES = 50 * 1024;
export const MAX_ICON_MARKUP_CHARS = 20 * 1024;

export type CustomBadgeIcon = { id: string; name: string; svg: string; createdAt: string };

// ── Sanitising ───────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'title', 'desc',
]);
const DRAWABLE = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use']);

const ALLOWED_ATTRIBUTES = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'viewbox',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'id',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'clip-path', 'mask', 'href',
  'xlink:href', 'preserveaspectratio', 'clippathunits', 'maskunits', 'fx', 'fy', 'spreadmethod', 'vector-effect',
]);
const STYLE_PROPERTIES = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap',
  'stroke-linejoin', 'stop-color', 'stop-opacity',
]);
const COLOUR_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color']);

/** Only references inside the icon itself (`#id`, `url(#id)`) are allowed. */
function safeValue(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.includes('javascript:') || v.includes('expression(') || v.includes('<')) return false;
  if (name === 'href' || name === 'xlink:href') return v.startsWith('#');
  if (v.includes('url(')) return /^url\(\s*['"]?#[\w-]+['"]?\s*\)$/.test(v);
  return true;
}

export class IconValidationError extends Error {}

/**
 * The cleaned SVG markup, or an error saying why it cannot be used.
 * `recolour` makes the icon follow the badge's text colour, by drawing every
 * solid colour in `currentColor`; off keeps the icon's own colours.
 */
export function sanitiseSvg(markup: string, recolour: boolean): string {
  if (typeof DOMParser === 'undefined') throw new IconValidationError('Icons can only be read in the browser.');
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new IconValidationError('The file is not valid SVG — it could not be read.');
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') throw new IconValidationError('The file is not an SVG image.');

  let drawable = 0;
  const clean = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.localName.toLowerCase();
      if (!ALLOWED_ELEMENTS.has(tag) || (child.namespaceURI && child.namespaceURI !== SVG_NS)) {
        child.remove();
        continue;
      }
      if (DRAWABLE.has(tag)) drawable += 1;
      cleanAttributes(child);
      clean(child);
    }
  };
  const cleanAttributes = (el: Element) => {
    // Simple style declarations become attributes; the rest of `style` goes.
    const style = el.getAttribute('style');
    if (style) {
      for (const declaration of style.split(';')) {
        const [rawName, ...rest] = declaration.split(':');
        const name = rawName?.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (name && value && STYLE_PROPERTIES.has(name) && safeValue(name, value) && !el.hasAttribute(name)) el.setAttribute(name, value);
      }
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(name) || !safeValue(name, attr.value)) el.removeAttribute(attr.name);
    }
    if (recolour) {
      for (const name of COLOUR_ATTRIBUTES) {
        const value = el.getAttribute(name)?.trim().toLowerCase();
        if (value && value !== 'none' && value !== 'currentcolor' && !value.startsWith('url(') && value !== 'transparent') {
          el.setAttribute(name, 'currentColor');
        }
      }
    }
  };

  cleanAttributes(root);
  clean(root);
  // Text in an icon is never drawn by the badge (it has its own text).
  for (const node of [...root.childNodes]) if (node.nodeType === 3 && !node.textContent?.trim()) node.remove();
  if (drawable === 0) throw new IconValidationError('The SVG has no shapes to draw.');

  // A viewBox lets the icon scale to every badge size.
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width') ?? '');
    const h = parseFloat(root.getAttribute('height') ?? '');
    if (!(w > 0 && h > 0)) throw new IconValidationError('The SVG needs a viewBox (or a width and height) so it can scale to badge sizes.');
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('xmlns', SVG_NS);
  if (recolour && !root.getAttribute('fill')) root.setAttribute('fill', 'currentColor');

  const out = new XMLSerializer().serializeToString(root).replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
  if (out.length > MAX_ICON_MARKUP_CHARS) throw new IconValidationError(`The icon is too detailed (${Math.round(out.length / 1024)} KB once cleaned; the limit is ${MAX_ICON_MARKUP_CHARS / 1024} KB). Simplify it and try again.`);
  return out;
}

/** Read and check an uploaded file; resolves to clean SVG markup. */
export async function readIconFile(file: File, recolour: boolean): Promise<string> {
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  if (!isSvg) {
    throw new IconValidationError(`“${file.name}” is not an SVG file. Custom icons must be SVG, so they stay sharp at every badge size.`);
  }
  if (file.size === 0) throw new IconValidationError(`“${file.name}” is empty.`);
  if (file.size > MAX_ICON_FILE_BYTES) {
    throw new IconValidationError(`“${file.name}” is ${Math.round(file.size / 1024)} KB; icons must be ${MAX_ICON_FILE_BYTES / 1024} KB or smaller.`);
  }
  return sanitiseSvg(await file.text(), recolour);
}

// ── The value stored on a badge ──────────────────────────────────────────────

export function encodeIconValue(icon: Pick<CustomBadgeIcon, 'id' | 'svg'>): string {
  return `${CUSTOM_ICON_PREFIX}${icon.id}:${icon.svg}`;
}

export function isCustomIconValue(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith(CUSTOM_ICON_PREFIX));
}

export function customIconId(value: string | null | undefined): string | null {
  if (!isCustomIconValue(value)) return null;
  const rest = value.slice(CUSTOM_ICON_PREFIX.length);
  const colon = rest.indexOf(':');
  return colon > 0 ? rest.slice(0, colon) : null;
}

const renderCache = new Map<string, string | null>();

/** The SVG to draw for a badge value — cleaned again here, since it came from storage. */
export function customIconMarkup(value: string | null | undefined): string | null {
  if (!isCustomIconValue(value)) return null;
  const cached = renderCache.get(value);
  if (cached !== undefined) return cached;
  const rest = value.slice(CUSTOM_ICON_PREFIX.length);
  const colon = rest.indexOf(':');
  let markup: string | null = null;
  try {
    // Colours were settled at upload; keep whatever the stored icon has.
    markup = colon > 0 ? sanitiseSvg(rest.slice(colon + 1), false) : null;
  } catch {
    markup = null;
  }
  if (renderCache.size > 500) renderCache.clear();
  renderCache.set(value, markup);
  return markup;
}

// ── The library (this browser) ───────────────────────────────────────────────

const STORAGE_KEY = 'pdp-custom-badge-icons-v1';

function readLibrary(): CustomBadgeIcon[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as CustomBadgeIcon[];
    return Array.isArray(parsed)
      ? parsed
          .filter((i) => i && typeof i.id === 'string' && /^[\w-]+$/.test(i.id) && typeof i.svg === 'string')
          .map((i) => ({ ...i, name: typeof i.name === 'string' && i.name.trim() ? i.name : 'Custom icon' }))
          // Stored markup is cleaned again before anything draws it.
          .flatMap((i) => {
            try {
              return [{ ...i, svg: sanitiseSvg(i.svg, false) }];
            } catch {
              return [];
            }
          })
      : [];
  } catch {
    return [];
  }
}

let library: CustomBadgeIcon[] = readLibrary();
const listeners = new Set<() => void>();

function emit(next: CustomBadgeIcon[]) {
  library = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    library = readLibrary();
    listeners.forEach((l) => l());
  });
}

export function useCustomIconLibrary(): CustomBadgeIcon[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => library,
    () => library,
  );
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new IconValidationError('An icon needs a name.');
  if (trimmed.length > 60) throw new IconValidationError('Keep the name to 60 characters or fewer.');
  return trimmed;
}

export function addCustomIcon(name: string, svg: string): CustomBadgeIcon {
  const icon = { id: newId(), name: cleanName(name), svg, createdAt: new Date().toISOString() };
  emit([...library, icon]);
  return icon;
}

/** Rename — also how an icon found on a badge joins this library under a name. */
export function renameCustomIcon(icon: Pick<CustomBadgeIcon, 'id' | 'svg'>, name: string) {
  const clean = cleanName(name);
  if (library.some((i) => i.id === icon.id)) emit(library.map((i) => (i.id === icon.id ? { ...i, name: clean } : i)));
  else emit([...library, { id: icon.id, name: clean, svg: icon.svg, createdAt: new Date().toISOString() }]);
}

export function removeCustomIcon(id: string) {
  emit(library.filter((i) => i.id !== id));
}

/** The icon stored in a badge value, if it is a custom one. */
export function iconFromValue(value: string | null | undefined): Pick<CustomBadgeIcon, 'id' | 'svg'> | null {
  const id = customIconId(value);
  const svg = customIconMarkup(value);
  return id && svg ? { id, svg } : null;
}
