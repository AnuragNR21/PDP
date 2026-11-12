import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { modelDefinitionsApi } from '../api/modelDefinitionsApi';
import type { BadgeCustomization, BadgeOptions } from '../domain/types';
import { useToast } from '@/shared/toast/ToastContext';

const DEFAULT_BADGE_OPTIONS: BadgeOptions | null = null;

const BADGE_FIELDS: Array<keyof BadgeCustomization> = [
  'badgeText',
  'badgeShape',
  'badgeColor',
  'badgeTextColor',
  'badgeIcon',
  'badgeSize',
  'badgeContentType',
];

function sameBadge(a: BadgeCustomization | null, b: BadgeCustomization | null) {
  if (!a || !b) return a === b;
  return BADGE_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null));
}

/**
 * A type's badge, edited in line with the rest of its details panel.
 *
 * Changes made in the Badge tab are a draft, like the General tab's fields:
 * the panel's Save saves them, Cancel puts the saved badge back, and leaving
 * with unsaved badge changes asks first (`dirty`). Reset to Default only
 * resets the draft — it is saved like any other change.
 */
export function useBadgeCustomization(
  type: 'hierarchy-node' | 'support-element',
  entityId: string | null | undefined,
  callbacks?: { onSaved?: () => void },
) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [badge, setBadge] = useState<BadgeCustomization | null>(null);
  const [saved, setSaved] = useState<BadgeCustomization | null>(null);
  const [options, setOptions] = useState<BadgeOptions | null>(DEFAULT_BADGE_OPTIONS);
  const [saving, setSaving] = useState(false);

  // Load options once
  useEffect(() => {
    modelDefinitionsApi
      .getBadgeMetadata()
      .then(setOptions)
      .catch(() => {/* silently ignore */});
  }, []);

  // Load badge whenever the entity changes
  useEffect(() => {
    setBadge(null);
    setSaved(null);
    if (!entityId) return;
    let cancelled = false;
    const load =
      type === 'hierarchy-node'
        ? modelDefinitionsApi.getHierarchyNodeBadge(entityId)
        : modelDefinitionsApi.getSupportDomainElementBadge(entityId);

    load
      .then((loaded) => {
        if (cancelled) return;
        setBadge(loaded);
        setSaved(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        setBadge(null);
        setSaved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, type]);

  const dirty = Boolean(badge && saved && !sameBadge(badge, saved));

  const handleChange = useCallback((patch: Partial<BadgeCustomization>) => {
    setBadge((current) => (current ? { ...current, ...patch } : current));
  }, []);

  /** Save the draft badge, if it changed. Resolves false when saving failed. */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!entityId || !badge || sameBadge(badge, saved)) return true;
    setSaving(true);
    try {
      const result =
        type === 'hierarchy-node'
          ? await modelDefinitionsApi.saveHierarchyNodeBadge(entityId, badge)
          : await modelDefinitionsApi.saveSupportDomainElementBadge(entityId, badge);
      setBadge(result);
      setSaved(result);
      // Diagrams, pickers and custom-icon usage read badges from the type options.
      void queryClient.invalidateQueries({ queryKey: ['cross-model-type-options'] });
      callbacks?.onSaved?.();
      return true;
    } catch {
      showToast('Failed to save badge.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [entityId, badge, saved, type, showToast, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Put the saved badge back. */
  const handleCancel = useCallback(() => {
    setBadge(saved);
  }, [saved]);

  /** Reset the draft to the default badge; saved with the panel's Save. */
  const handleReset = useCallback(() => {
    if (!entityId || !options) return;
    const defaults = options.defaults;
    setBadge((current) => ({
      badgeStoreId: current?.badgeStoreId ?? null,
      ownerEntityType: type === 'hierarchy-node' ? 'hierarchy_model_node_type' : 'support_domain_element_type',
      ownerEntityId: entityId,
      badgeText: defaults.badgeText,
      badgeShape: defaults.badgeShape,
      badgeColor: defaults.badgeColor,
      badgeTextColor: defaults.badgeTextColor,
      badgeIcon: defaults.badgeIcon,
      badgeSize: defaults.badgeSize,
      badgeContentType: defaults.badgeContentType,
    }));
  }, [entityId, options, type]);

  return {
    badge,
    options,
    saving,
    dirty,
    onChange: handleChange,
    onSave: handleSave,
    onCancel: handleCancel,
    onReset: handleReset,
  };
}
