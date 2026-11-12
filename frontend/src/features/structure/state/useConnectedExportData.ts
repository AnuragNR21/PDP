import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { modelDefinitionsApi } from "@/features/model/api/modelDefinitionsApi";
import type { CrossModelTypeOption } from "@/features/model/domain/types";
import { structureApi } from "@/features/structure/api/structureApi";
import { useAllCrossModelLinks, useAllSupportDomainRelationships } from "@/features/structure/state/useStructureWorkspace";
import type { WorkspaceModel } from "@/shared/workspace/workspaceModel";
import type { CrossLinkRecord, CrossRuleEnd, Definitions, ExportModelKind, InstanceRecord } from "../domain/connectedExport";

/**
 * Everything Connected Model Export reads — all through the services PDP
 * already has, so access permissions are whatever they already are:
 *   • definitions: the type options, hierarchy node types (for recursion),
 *     Support Domain relationships and cross-model relationship rules;
 *   • instances: per model in scope, the existing Structure export rows (for
 *     External ID and description) and the instance list (for status);
 *   • cross-model links: the stored instance links between models.
 * Hierarchy (stored parent) and Support Domain (inherited from the model)
 * relationships need nothing more; links drawn on the SWS diagram are
 * diagram-only and are not read.
 * Nothing is written.
 */

const toKind = (modelType: string): ExportModelKind => (modelType === "SUPPORT_DOMAIN_MODEL" ? "support" : "hierarchy");

type HierarchyExportRow = {
  pdp_system_id: string;
  external_id: string | null;
  model_id: string;
  node_type_id: string;
  name: string;
  description: string | null;
  parent_pdp_system_id: string | null;
};
type SupportExportRow = {
  pdp_system_id: string;
  external_id: string | null;
  support_domain_model_id: string;
  element_type_id: string;
  name: string;
  description: string | null;
};

export type ConnectedExportTypeOption = CrossModelTypeOption;

/** Model definitions: every type, and every relationship allowed between types. */
export function useExportDefinitions(models: WorkspaceModel[], hierarchyModelIds: string[]) {
  const typeOptions = useQuery({ queryKey: ["cross-model-type-options"], queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions() });
  const crossRules = useQuery({ queryKey: ["cross-model-relationship-types", "all"], queryFn: () => modelDefinitionsApi.listCrossModelRelationshipTypes() });
  const sdRelationships = useAllSupportDomainRelationships();
  // Recursion is only on a node type's own record; read it for the hierarchy models in play.
  const nodeTypeQueries = useQueries({
    queries: hierarchyModelIds.map((id) => ({
      queryKey: ["hierarchy-node-types-for-model", id],
      queryFn: () => modelDefinitionsApi.listHierarchyNodeTypes(id),
    })),
  });
  const recursiveKey = nodeTypeQueries.map((q) => (q.data ?? []).filter((n) => n.isRecursive).map((n) => n.id).join(",")).join("|");

  const definitions = useMemo<Definitions | null>(() => {
    if (!typeOptions.data || !crossRules.data || !sdRelationships.data) return null;
    const recursive = new Set(recursiveKey.split(/[|,]/).filter(Boolean));
    const options = [...typeOptions.data.nodeTypes, ...typeOptions.data.elementTypes];
    const end = (type: string, modelId: string | null, typeId: string | null): CrossRuleEnd => ({ kind: toKind(type), modelId, typeId });
    return {
      models: models.map((m) => ({ id: m.id, name: m.name, kind: m.kind, status: m.status })),
      types: options.map((t) => ({
        id: t.id,
        name: t.name,
        modelId: t.modelId,
        kind: toKind(t.kind),
        parentId: t.parentId ?? null,
        isRecursive: recursive.has(t.id),
      })),
      sdRelationships: sdRelationships.data.map((r) => ({
        id: r.id,
        modelId: r.modelId || (options.find((t) => t.id === r.sourceElementId)?.modelId ?? ""),
        sourceTypeId: r.sourceElementId,
        targetTypeId: r.targetElementId,
        kind: r.relationshipKind,
      })),
      crossRules: crossRules.data.map((r) => ({
        id: r.id,
        name: r.name,
        source: end(r.sourceModelType, r.sourceModelId, r.sourceModelItemTypeId),
        target: end(r.targetModelType, r.targetModelId, r.targetModelItemTypeId),
      })),
    };
  }, [models, typeOptions.data, crossRules.data, sdRelationships.data, recursiveKey]);

  return {
    definitions,
    typeOptions: typeOptions.data ?? null,
    loading: typeOptions.isLoading || crossRules.isLoading || sdRelationships.isLoading || nodeTypeQueries.some((q) => q.isLoading),
    error: typeOptions.isError || crossRules.isError || sdRelationships.isError || nodeTypeQueries.some((q) => q.isError),
  };
}

/** The instances of every model in scope, and the stored cross-model links. */
export function useExportInstances(models: Array<{ id: string; kind: ExportModelKind }>) {
  const rowQueries = useQueries({
    queries: models.map((m) => ({
      queryKey: ["connected-export-rows", m.kind, m.id],
      queryFn: () => structureApi.exportStructureData(m.kind === "hierarchy" ? "hierarchy" : "support-domain", [m.id]),
    })),
  });
  const statusQueries = useQueries({
    queries: models.map((m) =>
      m.kind === "hierarchy"
        ? { queryKey: ["structure-nodes-for-model", m.id], queryFn: () => structureApi.listNodesForModel(m.id) as Promise<unknown> }
        : { queryKey: ["element-instances", m.id], queryFn: () => structureApi.listElementInstances(m.id) as Promise<unknown> },
    ),
  });
  const links = useAllCrossModelLinks();

  const stamp = [...rowQueries, ...statusQueries].map((q) => q.dataUpdatedAt).join(",");
  const instances = useMemo<InstanceRecord[]>(() => {
    const out: InstanceRecord[] = [];
    models.forEach((m, i) => {
      const rows = rowQueries[i]?.data as Record<string, unknown> | undefined;
      const statusData = statusQueries[i]?.data;
      if (!rows || !statusData) return;
      const status = new Map<string, string>();
      if (m.kind === "hierarchy") {
        for (const n of (statusData as { items?: Array<{ node_id: string; status: string }> }).items ?? []) status.set(n.node_id, n.status);
        for (const r of (rows.Load_Hierarchy_Node_Instances as HierarchyExportRow[] | undefined) ?? []) {
          out.push({
            id: r.pdp_system_id,
            externalId: r.external_id ?? null,
            modelId: r.model_id,
            typeId: r.node_type_id,
            name: r.name,
            description: r.description ?? null,
            status: status.get(r.pdp_system_id) ?? "unknown",
            parentId: r.parent_pdp_system_id ?? null,
          });
        }
      } else {
        for (const e of (statusData as Array<{ instance_id: string; status: string }>) ?? []) status.set(e.instance_id, e.status);
        for (const r of (rows.Load_Support_Domain_Elements as SupportExportRow[] | undefined) ?? []) {
          out.push({
            id: r.pdp_system_id,
            externalId: r.external_id ?? null,
            modelId: r.support_domain_model_id,
            typeId: r.element_type_id,
            name: r.name,
            description: r.description ?? null,
            status: status.get(r.pdp_system_id) ?? "unknown",
            parentId: null,
          });
        }
      }
    });
    return out;
  }, [models, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const crossLinks = useMemo<CrossLinkRecord[]>(
    () => (links.data ?? []).map((l) => ({ id: l.cross_model_instance_id, ruleId: l.relationship_rule_id, sourceId: l.source_instance_id, targetId: l.target_instance_id })),
    [links.data],
  );

  return {
    instances,
    crossLinks,
    loading: links.isLoading || rowQueries.some((q) => q.isLoading) || statusQueries.some((q) => q.isLoading),
    error: links.isError || rowQueries.some((q) => q.isError) || statusQueries.some((q) => q.isError),
  };
}
