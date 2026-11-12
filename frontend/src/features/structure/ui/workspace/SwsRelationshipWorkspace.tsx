import AddIcon from "@mui/icons-material/Add";
import SwapHorizOutlined from "@mui/icons-material/SwapHorizOutlined";
import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { InlineEditTable } from "@/shared/workspace/InlineEditTable";
import { RelationshipDetailsList } from "@/shared/workspace/RelationshipDetailsList";
import { AuthoringPanel, WorkspaceBody, useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import { SidePanel } from "@/shared/workspace/SidePanel";
import type { ProjectionView } from "@/shared/workspace/workspaceModel";
import { useToast } from "@/shared/toast/ToastContext";
import type { CrossModelInstance } from "@/features/structure/api/structureApi";
import {
  useActiveCrossModelRelationshipTypes,
  useAllCrossModelLinks,
  useDeleteCrossModelLink,
} from "@/features/structure/state/useStructureWorkspace";
import { SwsRelationshipDiagramView } from "./SwsRelationshipDiagramView";
import { CrossModelMatrixView, INSTANCE_MATRIX_CELL_FILTER_LABEL, type InstanceMatrixCellFilter } from "../CrossModelMatrixView";
import { useStructureWorkspace } from "../../contexts/StructureWorkspaceContext";
import { CrossModelLinkDialog, type LinkPreset } from "./CrossModelLinkDialog";
import type { ModelKind } from "@/shared/constants/ModelConfig";

const NOTE =
  "MWS defines which relationships are allowed between types, their names and their direction. SWS relates actual instances with those definitions only — never a new name or direction.";

const KIND_LABEL: Record<string, string> = { HIERARCHY_MODEL: "Hierarchy", SUPPORT_DOMAIN_MODEL: "Support Domain" };

/**
 * SWS › Relationship: actual relationships between instances of different
 * models. The governed types from MWS are the available options: a link is
 * made by picking one of them, and removed when it no longer applies — it is
 * never retyped. Matrix adds and removes in the cells; Diagram draws them, and
 * a clicked instance shows its relationships beside it; List lists them.
 */
export function SwsRelationshipWorkspace({ view }: { view: ProjectionView }) {
  const { showToast } = useToast();
  const links = useAllCrossModelLinks();
  const governed = useActiveCrossModelRelationshipTypes();
  const deleteLink = useDeleteCrossModelLink();
  const [dialog, setDialog] = useState<LinkPreset | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  // The selection panel of the Matrix and Diagram views is drawn in the
  // workspace's left column, as Model Selection is on the Model tab.
  const [selectionSlot, setSelectionSlot] = useState<HTMLDivElement | null>(null);
  const [selectionCollapsed, setSelectionCollapsed] = useStoredFlag("pdp-sws-relationship-selection-collapsed", false);
  const showsSelection = view !== "list";
  // Matrix: the same toolbar as the MWS Relationship Matrix — which cells to
  // show, which governed relationship, and Swap Source / Target.
  const [cellFilter, setCellFilter] = useState<InstanceMatrixCellFilter>("all");
  const [relationshipTypeId, setRelationshipTypeId] = useState<string>("all");
  const {
    crossModelRelationship: { matrixViewSelection: { sourceSelection, targetSelection } },
    setMatrixSourceSelection,
    setMatrixTargetSelection,
  } = useStructureWorkspace();
  // Turns the matrix round only: each relationship keeps its governed direction.
  const swapMatrix = () => {
    setMatrixSourceSelection(targetSelection);
    setMatrixTargetSelection(sourceSelection);
  };

  const typeName = useMemo(() => new Map((governed.data ?? []).map((type) => [type.id, type.name])), [governed.data]);
  const selectedLinks = (links.data ?? []).filter((link) => link.source_instance_id === selectedInstanceId || link.target_instance_id === selectedInstanceId);
  const selectedName = selectedLinks[0]
    ? selectedLinks[0].source_instance_id === selectedInstanceId
      ? { name: selectedLinks[0].source_instance_name, model: selectedLinks[0].source_model_name, modelId: selectedLinks[0].source_model_id, type: selectedLinks[0].source_type_name, kind: selectedLinks[0].source_instance_type }
      : { name: selectedLinks[0].target_instance_name, model: selectedLinks[0].target_model_name, modelId: selectedLinks[0].target_model_id, type: selectedLinks[0].target_type_name, kind: selectedLinks[0].target_instance_type }
    : null;

  const addButton = (
    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>
      Relationship
    </Button>
  );

  let authoring;
  if (view === "matrix") {
    authoring = (
      <AuthoringPanel
        title="Relationship – Matrix Workspace"
        hint="Click a Source × Target cell to create, change or delete the relationship between those two instances — only where the Model Workspace allows it, in its direction."
        toolbar={
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              value={relationshipTypeId}
              onChange={(event) => setRelationshipTypeId(event.target.value)}
              aria-label="Relationship filter"
              sx={{ minWidth: 180, maxWidth: 240, "& .MuiInputBase-root": { fontSize: 13, height: 32 } }}
            >
              <MenuItem value="all" sx={{ fontSize: 13 }}>All relationships</MenuItem>
              {(governed.data ?? []).map((type) => (
                <MenuItem key={type.id} value={type.id} sx={{ fontSize: 13 }}>{type.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              value={cellFilter}
              onChange={(event) => setCellFilter(event.target.value as InstanceMatrixCellFilter)}
              aria-label="Matrix cell filter"
              sx={{ minWidth: 220, "& .MuiInputBase-root": { fontSize: 13, height: 32 } }}
            >
              {(Object.keys(INSTANCE_MATRIX_CELL_FILTER_LABEL) as InstanceMatrixCellFilter[]).map((key) => (
                <MenuItem key={key} value={key} sx={{ fontSize: 13 }}>{INSTANCE_MATRIX_CELL_FILTER_LABEL[key]}</MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SwapHorizOutlined />}
              onClick={swapMatrix}
              disabled={!sourceSelection && !targetSelection}
              sx={{ whiteSpace: "nowrap" }}
            >
              Swap Source / Target
            </Button>
          </Stack>
        }
        flush
      >
        <Box sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CrossModelMatrixView
            selectionSlot={selectionSlot}
            cellFilter={cellFilter}
            relationshipTypeId={relationshipTypeId === "all" ? null : relationshipTypeId}
            onSwap={swapMatrix}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 1, fontStyle: "italic", borderTop: 1, borderColor: "divider" }}>{NOTE}</Typography>
      </AuthoringPanel>
    );
  } else if (view === "diagram") {
    authoring = (
      <AuthoringPanel
        title="Relationship – Diagram Workspace"
        hint="Drag from an instance's connector to another instance to relate them — only the instances the Model Workspace allows are ringed."
        toolbar={addButton}
        flush
      >
        <Box sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <SwsRelationshipDiagramView onSelectItem={setSelectedInstanceId} selectionSlot={selectionSlot} />
        </Box>
      </AuthoringPanel>
    );
  } else {
    authoring = (
      <AuthoringPanel title="Relationship – List Workspace" hint="Every relationship between instances — add one from the governed options, or remove it." toolbar={addButton} flush>
        <InlineEditTable<CrossModelInstance>
          rows={links.data ?? []}
          getId={(row) => row.cross_model_instance_id}
          getLabel={(row) => `${row.source_instance_name} → ${row.target_instance_name}`}
          // A link is one of the options the model offers: it is added or
          // removed, never retyped — so no edit here.
          draftOf={() => ({})}
          onDuplicate={(row) => setDialog({ typeId: row.relationship_rule_id, source: { kind: row.source_instance_type as ModelKind, modelId: row.source_model_id, instanceId: row.source_instance_id } })}
          onDelete={async (row) => {
            try {
              await deleteLink.mutateAsync({ crossModelInstanceId: row.cross_model_instance_id });
              showToast("Relationship deleted.");
            } catch (error) {
              showToast(error instanceof Error ? error.message : "Could not delete the relationship.", "error");
            }
          }}
          emptyText={links.isLoading ? "Loading relationships…" : "No relationships yet. Use + Relationship to add one."}
          searchPlaceholder="Search relationships…"
          columns={[
            {
              key: "source",
              label: "Source",
              render: (row) => (
                <>
                  <Typography variant="body2" fontWeight={600}>{row.source_instance_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.source_model_name} › {row.source_type_name}</Typography>
                </>
              ),
            },
            {
              key: "type",
              label: "Relationship",
              width: 220,
              filter: true,
              render: (row) => <Chip size="small" label={typeName.get(row.relationship_rule_id) ?? row.relationship_rule_id} sx={{ height: 20, fontSize: 11 }} />,
            },
            {
              key: "target",
              label: "Target",
              render: (row) => (
                <>
                  <Typography variant="body2" fontWeight={600}>{row.target_instance_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.target_model_name} › {row.target_type_name}</Typography>
                </>
              ),
            },
          ]}
        />
      </AuthoringPanel>
    );
  }

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
        {showsSelection && (
          <SidePanel title="Item Selection" collapsed={selectionCollapsed} onToggle={() => setSelectionCollapsed(!selectionCollapsed)} width={340}>
            <Box ref={setSelectionSlot} sx={{ display: "flex", minHeight: 0, pb: 1, "& > *": { flex: 1, minHeight: 0 }, "& > .MuiPaper-root": { border: "none", boxShadow: "none" } }} />
          </SidePanel>
        )}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <WorkspaceBody
        storageKey={`sws-relationship-${view}`}
        authoring={authoring}
        element={
          view === "diagram"
            ? {
                title: "Selected Element Instance Details",
                isEmpty: !selectedInstanceId,
                empty: "Click an instance on the diagram.",
                content: (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2" fontWeight={700}>{selectedName?.name ?? "Instance"}</Typography>
                    {selectedName && (
                      <Typography variant="body2" color="text.secondary">
                        {KIND_LABEL[selectedName.kind] ?? selectedName.kind} · {selectedName.model} › {selectedName.type}
                      </Typography>
                    )}
                    {!selectedName && <Typography variant="body2" color="text.secondary">This instance has no relationships yet.</Typography>}
                    <Box>
                      <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog({ source: selectedName ? { kind: selectedName.kind as ModelKind, modelId: selectedName.modelId, instanceId: selectedInstanceId ?? "" } : undefined })}>
                        Relationship
                      </Button>
                    </Box>
                  </Stack>
                ),
              }
            : undefined
        }
        relationship={
          view === "diagram"
            ? {
                title: "Relationship Details",
                isEmpty: !selectedInstanceId,
                empty: "Select an instance to see its immediate relationships.",
                content: (
                  <RelationshipDetailsList
                    loading={links.isLoading}
                    groups={[
                      {
                        title: "Relationships",
                        items: selectedLinks.map((link) => {
                          const outgoing = link.source_instance_id === selectedInstanceId;
                          return {
                            key: link.cross_model_instance_id,
                            label: outgoing ? link.target_instance_name : link.source_instance_name,
                            secondary: outgoing ? `${link.target_model_name} › ${link.target_type_name}` : `${link.source_model_name} › ${link.source_type_name}`,
                            relation: typeName.get(link.relationship_rule_id),
                            direction: outgoing ? ("out" as const) : ("in" as const),
                            onClick: () => setSelectedInstanceId(outgoing ? link.target_instance_id : link.source_instance_id),
                          };
                        }),
                      },
                    ]}
                  />
                ),
              }
            : undefined
        }
      />
        </Box>
      </Box>
      <CrossModelLinkDialog
        open={dialog !== null}
        preset={dialog ?? undefined}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

