import type { DisplayNamedItem } from './types';

export const displayLabel = (item: DisplayNamedItem) => item.displayName?.trim() || item.name;

export const hierarchyBadgeFallbackText = (label: string) => {
  const trimmed = label.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase();
};

export const supportDomainBadgeFallbackText = (label: string) => {
  const trimmed = label.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
};
