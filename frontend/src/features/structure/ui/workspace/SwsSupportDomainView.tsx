import AddIcon from "@mui/icons-material/Add";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { InlineEditTable } from "@/shared/workspace/InlineEditTable";
import { useFocusParam } from "@/shared/workspace/useFocusParam";
import { RelationshipDetailsList, type RelationshipDetailsGroup } from "@/shared/workspace/RelationshipDetailsList";
import { AuthoringPanel, WorkspaceBody } from "@/shared/workspace/WorkspacePanels";
import { DeleteAction, DuplicateAction } from "@/shared/workspace/WorkspaceIcons";
import { useToast } from "@/shared/toast/ToastContext";
import { uniqueCopyName } from "@/features/model/ui/workspace/HierarchyListView";
import type { ElementInstance, ElementRelationshipInstance } from "@/features/structure/api/structureApi";
import {
  useAllCrossModelLinks,
  useCreateElementInstance,
  useDeleteElementInstance,
  useElementInstances,
  useElementRelationshipInstances,
  useSaveSdDiagramLayout,
  useSdDiagramLayout,
  useSupportDomainElementTypes,
  useSupportDomainModels,
  useSupportDomainRelationships,
  useUpdateElementInstance,
} from "@/features/structure/state/useStructureWorkspace";
import { CreateEditElementInstanceDialog } from "../CreateEditElementInstanceDialog";
import { DeleteElementInstanceDialog } from "../DeleteElementInstanceDialog";
import { SupportDomainInstanceDiagram } from "../SupportDomainInstanceDiagram";
import { CanonicalBadge } from "../shared/CanonicalBadge";
import { SdInstanceEditor } from "./instanceEditors";
import { SdInstanceMatrix, SdMatrixToolbar, useSdMatrixState } from "./SdInstanceMatrix";
import { countByRelationship, relationshipKindLabel, useInstanceLinkAuthoring } from "./sdInstanceLinks";
import { followedCount, followedTotal, inheritedPartners } from "./sdFollowedRelationships";
import { ACTIVE, ARCHIVED, LifecycleChip, lifecycleLabel } from "./lifecycle";

const MODEL_NOTE =
  "MWS — the model defines which element types relate, and in which direction. SWS inherits it: every instance of the source type relates to every instance of the target type, and that is what the counts, this List and the exports use. Links drawn in the Diagram or Matrix are diagram-only: they must follow a model relationship, and they never change the inherited relationships.";

/** Partners listed per inherited relationship in Relationship Details; the rest are counted. */
const INHERITED_LIST_LIMIT = 50;

function errorDetail(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? (error instanceof Error ? error.message : fallback);
}

/**
 * SWS › Model › a support domain model: its element instances and the
 * relationships between them. The relationships are inherited from the model:
 * where it relates element type A to B, every A instance relates to every B
 * instance — the counts, the List and Relationship Details show those. The
 * Diagram and Matrix also let a person draw links between two instances (only
 * where the model allows); those are diagram-only (the edges of the support_domain_element_instance_relationship_diagram* combo) and
 * never change the inherited relationships. Diagram | Matrix | List share one
 * selection.
 */
export function SwsSupportDomainView({ modelId, view }: { modelId: string; view: "diagram" | "matrix" | "list" }) {
  const { showToast } = useToast();
  const supportModels = useSupportDomainModels();
  const elementTypes = useSupportDomainElementTypes(modelId);
  const modelRelationships = useSupportDomainRelationships(modelId);
  const instancesQuery = useElementInstances(modelId);
  const links = useAllCrossModelLinks();
  const instanceLinksQuery = useElementRelationshipInstances(modelId);
  const diagramLayoutQuery = useSdDiagramLayout(modelId);
  const saveDiagramLayout = useSaveSdDiagramLayout(modelId);
  const createInstance = useCreateElementInstance();
  const updateInstance = useUpdateElementInstance();
  const deleteInstance = useDeleteElementInstance();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ElementInstance | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setSelectedTypeId(null);
  }, [modelId]);

  const instances = instancesQuery.data ?? [];
  const types = elementTypes.data ?? [];
  const allowed = useMemo(() => modelRelationships.data ?? [], [modelRelationships.data]);
  // Lifecycle: relationships are authored only within an Active model, between
  // Active element types, with an Active relationship. Anything else stays on
  // screen but is not offered for new links.
  const sdModel = (supportModels.data ?? []).find((model) => model.id === modelId);
  const modelActive = !sdModel || sdModel.status === ACTIVE;
  const activeTypeIds = useMemo(() => new Set(types.filter((type) => type.status === ACTIVE).map((type) => type.id)), [types]);
  const authoringRelationships = useMemo(
    () =>
      allowed.map((rel) =>
        rel.status === ACTIVE && (!modelActive || !activeTypeIds.has(rel.sourceElementId) || !activeTypeIds.has(rel.targetElementId))
          ? { ...rel, status: "not-authorable" }
          : rel,
      ),
    [allowed, modelActive, activeTypeIds],
  );
  const invalidCount = modelActive ? 0 : instances.filter((instance) => instance.status !== ARCHIVED).length;
  const lifecycleBanner = !modelActive ? (
    <Alert severity={invalidCount > 0 ? "warning" : "info"} sx={{ borderRadius: 0, py: 0.25 }}>
      Model “{sdModel?.name}” is {lifecycleLabel(sdModel?.status)} in the Model Workspace, so no new instances or relationships can be created here.
      {invalidCount > 0 && ` ${invalidCount} instance${invalidCount === 1 ? " is" : "s are"} still Draft or Active, which is not valid under a ${lifecycleLabel(sdModel?.status)} model — archive ${invalidCount === 1 ? "it" : "them"}, or activate the model in the Model Workspace.`}
    </Alert>
  ) : null;
  const instanceLinks = useMemo(() => instanceLinksQuery.data ?? [], [instanceLinksQuery.data]);
  // Where the cards sit: the nodes of the model's diagram.
  const savedLayout = useMemo(
    () => Object.fromEntries((diagramLayoutQuery.data?.nodes ?? []).map((node) => [node.item_id, { x: node.pos_x, y: node.pos_y }])),
    [diagramLayoutQuery.data],
  );
  const onLayoutChange = (layout: Record<string, { x: number; y: number }> | null) =>
    saveDiagramLayout.mutate(layout, { onError: () => showToast("Could not save where the cards sit.", "error") });
  const linkCounts = useMemo(() => countByRelationship(instanceLinks), [instanceLinks]);
  const inheritedTotal = useMemo(() => followedTotal(instances, allowed), [instances, allowed]);
  const typeNameOf = (id: string) => types.find((type) => type.id === id)?.name ?? id;
  const authoringLinks = useInstanceLinkAuthoring({ relationships: authoringRelationships, links: instanceLinks, typeName: typeNameOf });
  const matrixControl = useSdMatrixState(modelId);
  // ?instance=<id> (from the global search): select that instance and its element type.
  const [focusInstance, consumeFocus] = useFocusParam("instance");
  useEffect(() => {
    if (!focusInstance || !instancesQuery.isSuccess) return;
    const found = (instancesQuery.data ?? []).find((instance) => instance.instance_id === focusInstance);
    if (found) {
      setSelectedId(found.instance_id);
      setSelectedTypeId(found.element_type_id);
    }
    consumeFocus();
  }, [focusInstance, instancesQuery.isSuccess, instancesQuery.data, consumeFocus]);
  const selected = instances.find((instance) => instance.instance_id === selectedId) ?? null;
  const badgeByType = useMemo(() => new Map(types.map((type) => [type.id, type.badge])), [types]);
  const duplicateInstance = async (instance: ElementInstance) => {
    try {
      const created = await createInstance.mutateAsync({
        support_domain_model_id: modelId,
        element_type_id: instance.element_type_id,
        name: uniqueCopyName(instance.name, instances.filter((item) => item.element_type_id === instance.element_type_id).map((item) => item.name)),
        description: instance.description,
      });
      setSelectedId(created.instance_id);
      showToast(`Duplicated as “${created.name}”.`);
    } catch (error) {
      showToast(errorDetail(error, "Could not duplicate."), "error");
    }
  };

  const relationshipGroups = (instance: ElementInstance): RelationshipDetailsGroup[] => {
    const select = (id: string) => () => setSelectedId(id);
    const cross = (links.data ?? []).filter((link) => link.source_instance_id === instance.instance_id || link.target_instance_id === instance.instance_id);
    const inherited = inheritedPartners(instance, instances, allowed, INHERITED_LIST_LIMIT).flatMap((group) => {
      const items = group.partners.map((partner) => ({
        key: `inherited:${group.relationship.id}:${group.direction}:${partner.instance_id}`,
        label: partner.name,
        secondary: partner.element_type_name,
        relation: relationshipKindLabel(group.relationship.relationshipKind),
        direction: group.direction,
        onClick: select(partner.instance_id),
      }));
      if (group.total > group.partners.length) {
        items.push({
          key: `inherited:${group.relationship.id}:${group.direction}:more`,
          label: `…and ${group.total - group.partners.length} more`,
          secondary: typeNameOf(group.direction === "out" ? group.relationship.targetElementId : group.relationship.sourceElementId),
          relation: relationshipKindLabel(group.relationship.relationshipKind),
          direction: group.direction,
          onClick: () => undefined,
        });
      }
      return items;
    });
    return [
      {
        title: "Support Domain — inherited from the model",
        emptyText: "The model relates this element type to nothing, or there are no instances at the other end yet.",
        items: inherited,
      },
      {
        title: "Drawn on the diagram",
        emptyText: "No link drawn for this instance. Drawn links are diagram-only.",
        items: instanceLinks
          .filter((link) => link.source_instance_id === instance.instance_id || link.target_instance_id === instance.instance_id)
          .map((link) => {
            const outgoing = link.source_instance_id === instance.instance_id;
            const otherId = outgoing ? link.target_instance_id : link.source_instance_id;
            const other = instances.find((item) => item.instance_id === otherId);
            return {
              key: link.relationship_instance_id,
              label: outgoing ? link.target_instance_name : link.source_instance_name,
              secondary: other?.element_type_name,
              relation: relationshipKindLabel(link.relationship_type),
              direction: outgoing ? ("out" as const) : ("in" as const),
              onClick: select(otherId),
            };
          }),
      },
      {
        title: "Relationships — other models",
        items: cross.map((link) => {
          const outgoing = link.source_instance_id === instance.instance_id;
          return {
            key: link.cross_model_instance_id,
            label: outgoing ? link.target_instance_name : link.source_instance_name,
            secondary: outgoing ? `${link.target_model_name} › ${link.target_type_name}` : `${link.source_model_name} › ${link.source_type_name}`,
            direction: outgoing ? ("out" as const) : ("in" as const),
          };
        }),
      },
    ];
  };

  const loading = instancesQuery.isLoading || elementTypes.isLoading || modelRelationships.isLoading || instanceLinksQuery.isLoading;
  const addButtons = (
    <Stack direction="row" spacing={1}>
      <Tooltip title={modelActive ? "" : `Model “${sdModel?.name}” is ${lifecycleLabel(sdModel?.status)} — new instances can only be created from Active models.`}>
        <span>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} disabled={!modelActive}>
            {view === "diagram" ? "Element Instance" : "Element"}
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );

  let authoring;
  if (loading) {
    authoring = (
      <AuthoringPanel title="Support Domain Workspace">
        <CircularProgress size={22} />
      </AuthoringPanel>
    );
  } else if (instancesQuery.isError) {
    authoring = (
      <AuthoringPanel title="Support Domain Workspace">
        <Alert severity="error">Could not load element instances.</Alert>
      </AuthoringPanel>
    );
  } else if (view === "diagram") {
    authoring = (
      <AuthoringPanel title="Support Domain Diagram Workspace" hint={MODEL_NOTE} toolbar={addButtons} flush>
        {lifecycleBanner}
        <Box sx={{ flex: 1, minHeight: 420, p: 1 }}>
          {diagramLayoutQuery.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}><CircularProgress size={24} /></Box>
          ) : (
          <SupportDomainInstanceDiagram
            key={modelId}
            savedLayout={savedLayout}
            onLayoutChange={onLayoutChange}
            elementTypes={types}
            instances={instances}
            relationships={authoringRelationships}
            links={instanceLinks}
            selectedInstanceId={selectedId}
            onLink={authoringLinks.link}
            onRemoveLink={authoringLinks.remove}
            onSelectInstance={(instance) => setSelectedId(instance.instance_id)}
            onSelectElementType={setSelectedTypeId}
            selectedElementTypeId={selectedTypeId}
          />
          )}
        </Box>
      </AuthoringPanel>
    );
  } else if (view === "matrix") {
    authoring = (
      <AuthoringPanel
        title="Support Domain Matrix Workspace"
        hint="Click a Source × Target cell to create or delete the relationships between those two instances — only where the model allows it, in its direction."
        toolbar={
          <Stack direction="row" spacing={1} alignItems="center">
            <SdMatrixToolbar control={matrixControl} />
            {addButtons}
          </Stack>
        }
        flush
      >
        {lifecycleBanner}
        <SdInstanceMatrix
          control={matrixControl}
          elementTypes={types}
          modelRelationships={authoringRelationships}
          instances={instances}
          links={instanceLinks}
          selectedInstanceId={selectedId}
          onSelectInstance={(instance) => setSelectedId(instance.instance_id)}
          onLink={authoringLinks.link}
          onRemoveLink={authoringLinks.remove}
        />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 1, fontStyle: "italic", borderTop: 1, borderColor: "divider" }}>
          {MODEL_NOTE}
        </Typography>
      </AuthoringPanel>
    );
  } else {
    const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? id;
    authoring = (
      <AuthoringPanel title="Support Domain List Workspace" hint="Every element instance in the selected support domain model — edit, duplicate and delete in line." toolbar={addButtons}>
        <Stack spacing={2}>
          {lifecycleBanner}
          <Box>
            <Typography variant="overline" color="text.secondary">Element Instances ({instances.length})</Typography>
            <InlineEditTable
              rows={instances}
              getId={(row) => row.instance_id}
              getLabel={(row) => row.name}
              draftOf={(row) => ({ name: row.name, description: row.description ?? "" })}
              onSave={async (row, draft) => {
                if (!draft.name?.trim()) {
                  showToast("An element instance needs a name.", "error");
                  return false;
                }
                try {
                  await updateInstance.mutateAsync({ instanceId: row.instance_id, payload: { name: draft.name.trim(), description: draft.description || null } });
                  showToast("Element instance updated.");
                  return true;
                } catch (error) {
                  showToast(errorDetail(error, "Could not update."), "error");
                  return false;
                }
              }}
              onDuplicate={(row) => void duplicateInstance(row)}
              onDelete={(row) => { setDeleteError(null); setDeleteTarget(row); }}
              selectedId={selectedId}
              onRowClick={(row) => setSelectedId(row.instance_id)}
              emptyText="No element instances yet. Use + Element to add one."
              searchPlaceholder="Search element instances…"
              columns={[
                {
                  key: "name",
                  label: "Element Instance",
                  render: (row) => (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CanonicalBadge badge={badgeByType.get(row.element_type_id)} fallbackText={row.name} size={22} />
                      <Typography variant="body2" fontWeight={600}>{row.name}</Typography>
                    </Stack>
                  ),
                  editor: { field: "name" },
                  value: (row) => row.name,
                },
                { key: "type", label: "Element Type", filter: true, render: (row) => row.element_type_name },
                { key: "description", label: "Description", render: (row) => row.description || "—", editor: { field: "description" } },
                { key: "status", label: "Status", width: 110, filter: true, render: (row) => <LifecycleChip status={row.status} showActive />, value: (row) => lifecycleLabel(row.status) },
              ]}
            />
          </Box>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Relationships — inherited from the model ({allowed.length} defined · {inheritedTotal.toLocaleString()} instance relationships)
            </Typography>
            <InlineEditTable
              rows={allowed}
              getId={(row) => row.id}
              getLabel={(row) => `${typeName(row.sourceElementId)} → ${typeName(row.targetElementId)}`}
              draftOf={() => ({})}
              emptyText="The model defines no relationships between its element types, so its instances inherit none."
              searchPlaceholder="Search model relationships…"
              columns={[
                { key: "source", label: "Source Element Type", render: (row) => typeName(row.sourceElementId) },
                { key: "kind", label: "Relationship", width: 180, filter: true, render: (row) => <Chip size="small" variant="outlined" label={relationshipKindLabel(row.relationshipKind)} sx={{ height: 20, fontSize: 11 }} /> },
                { key: "target", label: "Target Element Type", render: (row) => typeName(row.targetElementId) },
                { key: "count", label: "Inherited Links", width: 130, render: (row) => followedCount(instances, row).toLocaleString(), value: (row) => followedCount(instances, row) },
                { key: "drawn", label: "Drawn on Diagram", width: 140, render: (row) => linkCounts.get(row.id) ?? 0, value: (row) => linkCounts.get(row.id) ?? 0 },
              ]}
            />
          </Box>
          <Box>
            <Typography variant="overline" color="text.secondary">Diagram Links — drawn in Diagram / Matrix ({instanceLinks.length})</Typography>
            <InlineEditTable<ElementRelationshipInstance>
              rows={instanceLinks}
              getId={(row) => row.relationship_instance_id}
              getLabel={(row) => `${row.source_instance_name} ${relationshipKindLabel(row.relationship_type)} ${row.target_instance_name}`}
              draftOf={() => ({})}
              onDelete={(row) => authoringLinks.remove(row)}
              selectedId={null}
              onRowClick={(row) => setSelectedId(row.source_instance_id)}
              emptyText="No link drawn yet. Draw one in the Diagram (drag) or the Matrix (＋). Drawn links are diagram-only."
              searchPlaceholder="Search diagram links…"
              columns={[
                { key: "source", label: "Source Instance", render: (row) => row.source_instance_name, value: (row) => row.source_instance_name },
                { key: "sourceType", label: "Source Type", filter: true, render: (row) => typeName(row.source_element_type_id), value: (row) => typeName(row.source_element_type_id) },
                { key: "kind", label: "Relationship", width: 170, filter: true, render: (row) => <Chip size="small" label={relationshipKindLabel(row.relationship_type)} sx={{ height: 20, fontSize: 11 }} />, value: (row) => relationshipKindLabel(row.relationship_type) },
                { key: "target", label: "Target Instance", render: (row) => row.target_instance_name, value: (row) => row.target_instance_name },
                { key: "targetType", label: "Target Type", filter: true, render: (row) => typeName(row.target_element_type_id), value: (row) => typeName(row.target_element_type_id) },
              ]}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>{MODEL_NOTE}</Typography>
        </Stack>
      </AuthoringPanel>
    );
  }

  return (
    <>
      <WorkspaceBody
        storageKey={`sws-support-${view}`}
        authoring={authoring}
        element={
          view === "list"
            ? undefined
            : {
                title: "Element Instance Details",
                isEmpty: !selected,
                empty: view === "matrix" ? "Click an instance name in the matrix headers." : "Select an element instance on the diagram.",
                flush: true,
                actions: selected ? (
                  <Stack direction="row">
                    <DuplicateAction label={selected.name} onClick={() => void duplicateInstance(selected)} />
                    <DeleteAction label={selected.name} onClick={() => { setDeleteError(null); setDeleteTarget(selected); }} />
                  </Stack>
                ) : undefined,
                content: selected && (
                  <SdInstanceEditor key={selected.instance_id} embedded inst={selected} onDelete={() => { setDeleteError(null); setDeleteTarget(selected); }} onSaved={() => undefined} />
                ),
              }
        }
        relationship={
          view === "list"
            ? undefined
            : {
                title: "Relationship Details",
                isEmpty: !selected,
                empty: "Select an element instance to see its immediate relationships.",
                content: selected && <RelationshipDetailsList groups={relationshipGroups(selected)} loading={links.isLoading || instanceLinksQuery.isLoading} />,
              }
        }
      />
      {authoringLinks.element}
      <CreateEditElementInstanceDialog
        dialogMode="create"
        open={createOpen}
        supportDomainModels={(supportModels.data ?? []).map((model) => ({ id: model.id, name: model.name, status: model.status }))}
        initialModelId={modelId}
        initialTypeId={selectedTypeId ?? selected?.element_type_id ?? undefined}
        onClose={() => setCreateOpen(false)}
        onDone={() => setCreateOpen(false)}
      />
      <DeleteElementInstanceDialog
        instanceId={deleteTarget?.instance_id ?? null}
        instanceName={deleteTarget?.name ?? "Element instance"}
        deleting={deleteInstance.isPending}
        actionError={deleteError}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError(null);
          try {
            await deleteInstance.mutateAsync({ instanceId: deleteTarget.instance_id });
            if (selectedId === deleteTarget.instance_id) setSelectedId(null);
            setDeleteTarget(null);
          } catch (error) {
            setDeleteError(errorDetail(error, "Failed to delete."));
          }
        }}
      />
    </>
  );
}
