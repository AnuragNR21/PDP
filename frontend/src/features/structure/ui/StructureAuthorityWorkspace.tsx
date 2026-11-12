import { Alert, Box, CircularProgress, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModelSelectionPanel } from "@/shared/workspace/ModelSelectionPanel";
import { ModelHeaderCard, ModelNav, ProjectionNav } from "@/shared/workspace/WorkspaceChrome";
import { WorkspaceLanding } from "@/shared/workspace/WorkspaceLanding";
import { useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import { useRecentModels } from "@/shared/workspace/useRecentModels";
import { useWorkspaceParams } from "@/shared/workspace/useWorkspaceParams";
import { WORKSPACE_TABS, projectionsFor, type ModelKind, type WorkspaceModel } from "@/shared/workspace/workspaceModel";
import {
  useElementInstances,
  useElementRelationshipInstances,
  useHierarchyModels,
  useModelNodeInstances,
  useSupportDomainModels,
  useSupportDomainRelationships,
} from "@/features/structure/state/useStructureWorkspace";
import { followedTotal } from "./workspace/sdFollowedRelationships";
import { StructureImportExportPanel } from "./StructureImportExportPanel";
import { ConnectedModelExport } from "./exchange/ConnectedModelExport";
import { SwsHierarchyView } from "./workspace/SwsHierarchyView";
import { SwsRelationshipWorkspace } from "./workspace/SwsRelationshipWorkspace";
import { SwsSupportDomainView } from "./workspace/SwsSupportDomainView";
import { flattenTree } from "./workspace/instanceEditors";

/**
 * Data Exchange (Data Transfer): the Structure Workspace's round-trip CSV
 * import and export, and the read-only Connected Model Export.
 */
function SwsDataExchange(props: { models: WorkspaceModel[]; modelsLoading: boolean }) {
  const [connected, setConnected] = useStoredFlag("pdp-sws-exchange-connected-export", false);
  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
      <Paper variant="outlined" sx={{ px: 2, py: 1.25 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", md: "center" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700}>Data Exchange Workspace</Typography>
            {connected ? (
              <Typography variant="body2" color="text.secondary">
                <b>Connected Model Export</b> — choose one or more models, review the relationships between their types, and export the
                connected instances as one ZIP (Instances.csv, Relationships.csv, Scope.txt) for reporting tools and AI agents. Read-only:
                nothing in PDP is changed, and the package is not for re-import.
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Round-trip import and export of <b>Structure Workspace data</b> governed by the selected models: hierarchy node instances and their
                parent-child structure, and support domain element instances with the links drawn between them on the diagram. Imports are validated against the Model Workspace definitions before
                anything is committed; exports keep the identifiers needed to update and re-import.
              </Typography>
            )}
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={connected ? "connected" : "round-trip"}
            onChange={(_event, value: string | null) => value && setConnected(value === "connected")}
            aria-label="Data transfer function"
          >
            <ToggleButton value="round-trip" sx={{ textTransform: "none", px: 1.5 }}>Import / Export</ToggleButton>
            <ToggleButton value="connected" sx={{ textTransform: "none", px: 1.5 }}>Connected Model Export</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Paper>
      {connected ? (
        <ConnectedModelExport models={props.models} modelsLoading={props.modelsLoading} />
      ) : (
        <Box display="flex" minHeight={0} minWidth={0} flex={1} sx={{ width: "100%", overflow: "hidden" }}>
          <StructureImportExportPanel />
        </Box>
      )}
    </Stack>
  );
}

/** The counts in the header of an open model. */
function useModelCounts(model: WorkspaceModel | null) {
  const nodes = useModelNodeInstances(model?.kind === "hierarchy" ? model.id : null);
  const instances = useElementInstances(model?.kind === "support" ? model.id : null);
  const instanceLinks = useElementRelationshipInstances(model?.kind === "support" ? model.id : null);
  const modelRelationships = useSupportDomainRelationships(model?.kind === "support" ? model.id : null);
  return useMemo(() => {
    if (!model) return [];
    if (model.kind === "hierarchy") {
      const all = flattenTree(nodes.data ?? []);
      return [
        { label: "Node Instances", value: nodes.isSuccess ? all.length : "…" },
        { label: "Relationships", value: nodes.isSuccess ? all.filter((node) => node.parent_node_id).length : "…" },
      ];
    }
    // Relationships are inherited from the model (every A × every B); drawn
    // diagram links are counted apart and change nothing.
    return [
      { label: "Element Instances", value: instances.isSuccess ? instances.data.length : "…" },
      {
        label: "Relationships",
        value: instances.isSuccess && modelRelationships.isSuccess ? followedTotal(instances.data, modelRelationships.data).toLocaleString() : "…",
      },
      { label: "Diagram Links", value: instanceLinks.isSuccess ? instanceLinks.data.length : "…" },
    ];
  }, [model, nodes.data, nodes.isSuccess, instances.data, instances.isSuccess, instanceLinks.data, instanceLinks.isSuccess, modelRelationships.data, modelRelationships.isSuccess]);
}

/**
 * SWS — the Structure Workspace, on the layout it shares with MWS
 * (PDP-UIUX-001). Model Navigation (Model | Relationship | Data Exchange); on
 * Model, select a governing model and manage its instances: Hierarchy | List
 * for a hierarchy model, Diagram | Matrix | List for a support domain model.
 * Models are defined in MWS, so there is no + Model here, and ✎ Model opens
 * the model there.
 */
export function StructureAuthorityWorkspace() {
  const navigate = useNavigate();
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const { params, update, selectModel } = useWorkspaceParams("sws");
  const { recent, remember } = useRecentModels("sws");
  // Folds only when the person folds it; opening a model leaves it as it was.
  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag("pdp-sws-model-selection-collapsed", false);

  const models = useMemo<WorkspaceModel[]>(
    () => [
      ...(hierarchyModels.data ?? []).map((model) => ({ id: model.id, kind: "hierarchy" as const, name: model.name, description: model.purpose, status: model.status })),
      ...(supportModels.data ?? []).map((model) => ({ id: model.id, kind: "support" as const, name: model.name, description: model.purpose, status: model.status })),
    ],
    [hierarchyModels.data, supportModels.data],
  );
  const loading = hierarchyModels.isLoading || supportModels.isLoading;
  const openModel = params.modelId ? models.find((model) => model.id === params.modelId && model.kind === params.kind) ?? null : null;
  const counts = useModelCounts(openModel);

  useEffect(() => {
    if (openModel) remember(openModel.kind, openModel.id);
  }, [openModel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link to a model that no longer exists goes back to the landing page.
  useEffect(() => {
    if (!loading && params.modelId && !openModel) selectModel(null, null, { replace: true });
  }, [loading, params.modelId, openModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseModel = (kind: ModelKind, id: string) => {
    selectModel(kind, id);
  };

  const views = projectionsFor("sws", params.tab, openModel?.kind ?? null);
  const view = params.view ?? views[0] ?? null;
  const setView = (next: typeof view) => update({ view: next }, { replace: true });

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: "flex", maxWidth: "100%" }}>
      <ModelNav value={params.tab} tabs={WORKSPACE_TABS.sws} onChange={(tab) => update({ tab })} />
      {(hierarchyModels.isError || supportModels.isError) && <Alert severity="error">Could not load models.</Alert>}

      {params.tab === "model" && (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
          <ModelSelectionPanel
            models={models}
            selected={openModel ? { kind: openModel.kind, id: openModel.id } : null}
            onSelect={chooseModel}
            onHome={() => selectModel(null, null)}
            collapsed={selectionCollapsed}
            onToggleCollapsed={() => setSelectionCollapsed(!selectionCollapsed)}
            loading={loading}
          />
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {!openModel ? (
              loading && params.modelId ? (
                <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>
              ) : (
                <WorkspaceLanding workspace="sws" models={models} recent={recent} onOpen={chooseModel} />
              )
            ) : (
              <>
                <ModelHeaderCard
                  model={openModel}
                  counts={counts}
                  editTooltip="Models are defined in the Model Workspace — open this one there"
                  onEdit={() => navigate(`/model/tree-models?kind=${openModel.kind}&model=${encodeURIComponent(openModel.id)}`)}
                />
                <ProjectionNav views={views} value={view} onChange={setView} />
                {openModel.kind === "hierarchy" ? (
                  <SwsHierarchyView modelId={openModel.id} view={view === "list" ? "list" : "hierarchy"} />
                ) : (
                  <SwsSupportDomainView modelId={openModel.id} view={view === "list" ? "list" : view === "matrix" ? "matrix" : "diagram"} />
                )}
              </>
            )}
          </Stack>
        </Box>
      )}

      {params.tab === "relationship" && (
        <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
          <ProjectionNav views={views} value={view} onChange={setView} />
          <SwsRelationshipWorkspace view={view ?? "matrix"} />
        </Stack>
      )}

      {params.tab === "exchange" && <SwsDataExchange models={models} modelsLoading={loading} />}
    </Stack>
  );
}
