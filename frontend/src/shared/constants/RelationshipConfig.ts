/**
 * The relationship sources a shared diagram can draw.
 *
 * A cross-model relationship diagram is no longer only cross-model: it also shows
 * the relationships already set up inside a hierarchy model (its structural rules)
 * and inside a support domain model (its element relationships). Each drawn
 * connection carries the source it came from.
 */
export type RelationshipLinkCategory = 'CROSS_MODEL' | 'HIERARCHY' | 'SUPPORT_DOMAIN';

/** A hierarchy rule always draws parent → child containment, under one name: "Parent of". */
export const HIERARCHY_LINK_LABEL = 'Parent of';
