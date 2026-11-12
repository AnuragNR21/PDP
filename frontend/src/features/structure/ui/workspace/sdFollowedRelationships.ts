import type { SupportDomainRelationshipSummary } from "@/features/model/domain/types";
import type { ElementInstance } from "@/features/structure/api/structureApi";

export { relationshipKindLabel } from "./sdInstanceLinks";

/**
 * Support Domain relationships at the Structure level are inherited from the
 * model. Wherever the Model Workspace relates element type A to B, every
 * instance of A relates to every instance of B in the same way. They are not
 * stored and not chosen: change the model, or the instances, instead.
 *
 * This is what the counts, the List, Relationship Details and the exports
 * use. The links a person draws on the SWS Diagram / Matrix are diagram-only
 * (support_domain_element_instance_relationship_diagram_edges) and never change these.
 */

type Rel = Pick<SupportDomainRelationshipSummary, "id" | "sourceElementId" | "targetElementId" | "relationshipKind">;

/** How many instance relationships one model relationship produces. */
export function followedCount(instances: Pick<ElementInstance, "element_type_id">[], rel: Pick<Rel, "sourceElementId" | "targetElementId">) {
  let sources = 0;
  let targets = 0;
  for (const instance of instances) {
    if (instance.element_type_id === rel.sourceElementId) sources += 1;
    if (instance.element_type_id === rel.targetElementId) targets += 1;
  }
  return rel.sourceElementId === rel.targetElementId ? sources * Math.max(0, sources - 1) : sources * targets;
}

/** Every inherited instance relationship of a model, counted. */
export function followedTotal(instances: Pick<ElementInstance, "element_type_id">[], rels: Rel[]) {
  return rels.reduce((sum, rel) => sum + followedCount(instances, rel), 0);
}

export type InheritedPartner = {
  relationship: Rel;
  direction: "out" | "in";
  partner: ElementInstance;
};

/**
 * The instances one instance is related to by inheritance: for each model
 * relationship its type takes part in, every instance at the other end
 * (never itself). `limit` caps the partners listed per relationship; the
 * total is returned alongside so the rest can be counted, not dropped silently.
 */
export function inheritedPartners(instance: ElementInstance, instances: ElementInstance[], rels: Rel[], limit = Infinity) {
  const groups: Array<{ relationship: Rel; direction: "out" | "in"; partners: ElementInstance[]; total: number }> = [];
  for (const rel of rels) {
    for (const direction of ["out", "in"] as const) {
      const mine = direction === "out" ? rel.sourceElementId : rel.targetElementId;
      const other = direction === "out" ? rel.targetElementId : rel.sourceElementId;
      if (instance.element_type_id !== mine) continue;
      // A relationship from a type to itself is listed once, as outgoing.
      if (direction === "in" && rel.sourceElementId === rel.targetElementId) continue;
      const all = instances.filter((item) => item.element_type_id === other && item.instance_id !== instance.instance_id);
      groups.push({ relationship: rel, direction, partners: all.slice(0, limit), total: all.length });
    }
  }
  return groups;
}
