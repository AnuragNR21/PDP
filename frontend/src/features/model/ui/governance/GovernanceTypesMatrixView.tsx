import { renderSelection, type SelectionSlot } from "@/shared/workspace/SelectionSlot";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  MenuList,
  Paper,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SwapHorizOutlined from "@mui/icons-material/SwapHorizOutlined";
import { ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import type { WorkspaceModel } from "@/shared/workspace/workspaceModel";
import { useModelWorkspace } from "../../contexts/ModelWorkspaceContext";
import type {
  CrossModelRelationshipTypeSummary,
  CrossModelTypeOption,
  CrossModelTypeOptions,
} from "../../domain/types";
import { TypeSelectionPanel, kindOfType } from "./TypeSelectionPanel";

/**
 * Which cells the matrix shows. Presentation only — it never changes data.
 * - forward: cells holding a Source → Target relationship
 * - any: cells holding a relationship in either direction
 * - all: every Source × Target intersection
 */
export type MatrixCellFilter = "forward" | "any" | "all";

export const MATRIX_CELL_FILTER_LABEL: Record<MatrixCellFilter, string> = {
  forward: "Source → Target relationships",
  any: "With any relationship",
  all: "All possible",
};

const FORWARD_BG = "#EEF4FF";
const REVERSE_BG = "#F5F5F5";

// ── Cell popover ──────────────────────────────────────────────────────────────

function CellPopover({
  anchorEl,
  source,
  target,
  forward,
  reverse,
  onClose,
  onCreate,
  onEdit,
  onDelete,
  onSwap,
}: {
  anchorEl: HTMLElement | null;
  source: CrossModelTypeOption;
  target: CrossModelTypeOption;
  forward: CrossModelRelationshipTypeSummary[];
  reverse: CrossModelRelationshipTypeSummary[];
  onClose: () => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSwap: () => void;
}) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      PaperProps={{ sx: { minWidth: 240, maxWidth: 320, p: 1.5, borderRadius: 2 } }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {source.name} → {target.name}
      </Typography>
      <Divider sx={{ my: 1 }} />

      {forward.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5, fontSize: 12 }}>
          No relationship in this direction yet.
        </Typography>
      )}
      {forward.map((t) => (
        <Stack key={t.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.25 }}>
          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{t.name}</Typography>
          <Stack direction="row">
            <Tooltip title={`Edit ${t.name}`}>
              <IconButton size="small" aria-label={`Edit ${t.name}`} onClick={() => { onEdit(t.id); onClose(); }}>
                <EditOutlinedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={`Delete ${t.name}`}>
              <IconButton size="small" color="error" aria-label={`Delete ${t.name}`} onClick={() => { onDelete(t.id); onClose(); }}>
                <DeleteOutlineIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      ))}

      {reverse.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" fontWeight={700} display="block">
            Opposite direction — {target.name} → {source.name}
          </Typography>
          {reverse.map((t) => (
            <Typography key={t.id} variant="body2" color="text.disabled" sx={{ fontSize: 12, py: 0.25 }}>
              {t.name}
            </Typography>
          ))}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Read-only here. Swap Source / Target to edit it in its own direction.
          </Typography>
          <Button size="small" startIcon={<SwapHorizOutlined />} onClick={() => { onSwap(); onClose(); }} sx={{ mt: 0.5 }}>
            Swap Source / Target
          </Button>
        </>
      )}

      <Divider sx={{ my: 1 }} />
      <MenuList dense disablePadding>
        <MenuItem onClick={() => { onCreate(); onClose(); }} sx={{ fontSize: 12, borderRadius: 1 }}>
          <AddIcon sx={{ fontSize: 14, mr: 1 }} /> Create Relationship {source.name} → {target.name}
        </MenuItem>
      </MenuList>
    </Popover>
  );
}

// ── MatrixCell ────────────────────────────────────────────────────────────────

function MatrixCell({
  source,
  target,
  forward,
  reverse,
  shown,
  onCreate,
  onEdit,
  onDelete,
  onSwap,
}: {
  source: CrossModelTypeOption;
  target: CrossModelTypeOption;
  forward: CrossModelRelationshipTypeSummary[];
  reverse: CrossModelRelationshipTypeSummary[];
  /** False when the cell filter hides this cell: drawn blank and inert. */
  shown: boolean;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSwap: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const empty = forward.length === 0 && reverse.length === 0;
  const bg = !shown ? "transparent" : forward.length > 0 ? FORWARD_BG : reverse.length > 0 ? REVERSE_BG : "transparent";

  return (
    <>
      <Box
        component="td"
        data-cell={`${source.id}>${target.id}`}
        sx={{ p: 0, textAlign: "center", borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" }}
      >
        {shown ? (
          <Box
            role="button"
            aria-label={empty ? `Create relationship ${source.name} to ${target.name}` : `Relationships ${source.name} to ${target.name}`}
            onClick={(event) => (empty ? onCreate() : setAnchorEl(event.currentTarget))}
            sx={{
              minWidth: 120, minHeight: 48, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 0.5, p: 0.75,
              bgcolor: bg,
              "&:hover": { bgcolor: "action.hover" },
              "&:hover .pdp-cell-plus": { opacity: 0.45 },
              transition: "background 0.12s",
            }}
          >
            {empty && <Box className="pdp-cell-plus" sx={{ opacity: 0, fontSize: 18, lineHeight: 1 }}>+</Box>}
            {forward.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                size="small"
                sx={{
                  fontSize: 10, height: 18, bgcolor: "#EEF2FF", color: "#3730A3",
                  fontWeight: 700, border: "1px solid #C7D2FE", pointerEvents: "none", maxWidth: 160,
                  ".MuiChip-label": { px: "6px" },
                }}
              />
            ))}
            {reverse.map((t) => (
              <Tooltip key={t.id} title={`${t.name}: ${target.name} → ${source.name} (opposite direction, read-only here)`}>
                <Chip
                  label={`← ${t.name}`}
                  size="small"
                  sx={{
                    fontSize: 10, height: 18, bgcolor: "#FAFAFA", color: "text.disabled",
                    fontWeight: 600, border: "1px dashed", borderColor: "grey.400", maxWidth: 160,
                    ".MuiChip-label": { px: "6px" },
                  }}
                />
              </Tooltip>
            ))}
          </Box>
        ) : (
          <Box sx={{ minWidth: 120, minHeight: 48 }} />
        )}
      </Box>

      {anchorEl && (
        <CellPopover
          anchorEl={anchorEl}
          source={source}
          target={target}
          forward={forward}
          reverse={reverse}
          onClose={() => setAnchorEl(null)}
          onCreate={onCreate}
          onEdit={onEdit}
          onDelete={onDelete}
          onSwap={onSwap}
        />
      )}
    </>
  );
}

// ── Header cells ──────────────────────────────────────────────────────────────

function TypeLabel({ type, align }: { type: CrossModelTypeOption; align: "left" | "center" }) {
  const kind = kindOfType(type);
  return (
    <Tooltip title={`${kind === "hierarchy" ? "Node type" : "Element type"} · ${type.modelName}`}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" fontWeight={700} noWrap sx={{ fontSize: 11.5, display: "block", color: kind === "hierarchy" ? "#1D4ED8" : "#15803D", textAlign: align }}>
          {type.name}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={align === "center" ? "center" : "flex-start"} sx={{ minWidth: 0 }}>
          <ModelKindIcon kind={kind} size={12} sx={{ flexShrink: 0, "& svg": { fontSize: 9 } }} />
          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 9.5 }}>
            {type.modelName}
          </Typography>
        </Stack>
      </Box>
    </Tooltip>
  );
}

function ColHeaderCell({ type }: { type: CrossModelTypeOption }) {
  return (
    <Box
      component="th"
      sx={{
        position: "sticky", top: 0, zIndex: 3,
        bgcolor: "background.paper",
        minWidth: 120, maxWidth: 140,
        px: 1, py: 0.75,
        borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider",
      }}
    >
      <TypeLabel type={type} align="center" />
    </Box>
  );
}

// ── "Any" types panel ─────────────────────────────────────────────────────────

function AnyTypesPanel({
  governed,
  onEdit,
  onDelete,
}: {
  governed: CrossModelRelationshipTypeSummary[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (governed.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flexShrink: 0 }}>
      <Typography variant="overline" color="text.secondary" fontSize={11} letterSpacing={1}>
        Unconstrained relationships (any source / target)
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1} mt={0.5}>
        {governed.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            size="small"
            onDelete={() => onDelete(t.id)}
            onClick={() => onEdit(t.id)}
            sx={{ bgcolor: "#FFF7ED", color: "#C2410C", fontWeight: 600, fontSize: 11, border: "1px solid #FED7AA" }}
          />
        ))}
      </Stack>
    </Paper>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * MWS › Relationship › Matrix: Source types are rows, Target types columns,
 * and every cell is where the relationships between that pair are authored.
 * A cell shows the Source → Target relationships (blue, editable) and any
 * relationship running the other way (grey, read-only — swap to edit it).
 */
export function GovernanceTypesMatrixView({
  governedTypes,
  typeOptions,
  models,
  cellFilter,
  onSwap,
  onCreateForPair,
  onEdit,
  onDelete,
  selectionSlot,
}: {
  selectionSlot?: SelectionSlot;
  governedTypes: CrossModelRelationshipTypeSummary[];
  typeOptions: CrossModelTypeOptions;
  models: WorkspaceModel[];
  cellFilter: MatrixCellFilter;
  onSwap: () => void;
  onCreateForPair: (sourceModelType: string, sourceModelItemTypeId: string | null, targetModelType: string, targetModelItemTypeId: string | null) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const allTypes = useMemo<CrossModelTypeOption[]>(
    () => [...typeOptions.nodeTypes, ...typeOptions.elementTypes],
    [typeOptions.elementTypes, typeOptions.nodeTypes],
  );
  const { matrixTypeSelection, setMatrixSourceTypes, setMatrixTargetTypes } = useModelWorkspace();
  // Drop any picked type that no longer exists (deleted since it was picked).
  const typeIds = useMemo(() => new Set(allTypes.map((type) => type.id)), [allTypes]);
  const sourceTypes = matrixTypeSelection.sourceTypes.filter((type) => typeIds.has(type.id));
  const targetTypes = matrixTypeSelection.targetTypes.filter((type) => typeIds.has(type.id));

  const specificTypes = useMemo(
    () => governedTypes.filter((t) => t.sourceModelItemTypeId !== null && t.targetModelItemTypeId !== null),
    [governedTypes],
  );
  const anyTypes = governedTypes.filter((t) => t.sourceModelItemTypeId === null || t.targetModelItemTypeId === null);

  const byPair = useMemo(() => {
    const map = new Map<string, CrossModelRelationshipTypeSummary[]>();
    for (const t of specificTypes) {
      const key = `${t.sourceModelItemTypeId}>${t.targetModelItemTypeId}`;
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [specificTypes]);

  const cellOf = (row: CrossModelTypeOption, col: CrossModelTypeOption) => {
    const forward = byPair.get(`${row.id}>${col.id}`) ?? [];
    // A type related to itself has one direction only.
    const reverse = row.id === col.id ? [] : byPair.get(`${col.id}>${row.id}`) ?? [];
    return { forward, reverse };
  };
  const cellShown = (row: CrossModelTypeOption, col: CrossModelTypeOption) => {
    if (cellFilter === "all") return true;
    const { forward, reverse } = cellOf(row, col);
    return cellFilter === "forward" ? forward.length > 0 : forward.length + reverse.length > 0;
  };

  const rows = cellFilter === "all" ? sourceTypes : sourceTypes.filter((row) => targetTypes.some((col) => cellShown(row, col)));
  const cols = cellFilter === "all" ? targetTypes : targetTypes.filter((col) => sourceTypes.some((row) => cellShown(row, col)));

  const selectionPanel = renderSelection(selectionSlot, (
    <TypeSelectionPanel
      mode="matrix"
      models={models}
      types={allTypes}
      source={sourceTypes}
      target={targetTypes}
      onSourceChange={setMatrixSourceTypes}
      onTargetChange={setMatrixTargetTypes}
      onSwap={onSwap}
    />
  ), 340);

  if (allTypes.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography color="text.disabled">
          No node types or element types found. Add hierarchy models and support domain models first.
        </Typography>
      </Box>
    );
  }

  const hasSelection = sourceTypes.length > 0 && targetTypes.length > 0;

  return (
    <Box display="flex" flex={1} minHeight={0} gap={1.5}>
      {selectionPanel}

      <Box display="flex" flexDirection="column" flex={1} minWidth={0} minHeight={0} gap={1}>
        {!hasSelection && (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            gap={1}
            sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, py: 8, px: 4, bgcolor: "action.hover" }}
          >
            <Typography variant="body1" fontWeight={600} color="text.secondary">
              Select Source and Target types to build the matrix
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", maxWidth: 480 }}>
              Pick <strong>Source rows</strong> and <strong>Target columns</strong> in the selection panel — single types or a whole model.
              Click any cell to create a relationship between that pair.
            </Typography>
          </Box>
        )}

        {hasSelection && (rows.length === 0 || cols.length === 0) && (
          <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, py: 6, px: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No cells match “{MATRIX_CELL_FILTER_LABEL[cellFilter]}” for the selected types.
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Choose “All possible” to see every Source × Target cell and create a relationship.
            </Typography>
          </Box>
        )}

        {hasSelection && rows.length > 0 && cols.length > 0 && (
          <Box flex={1} minHeight={0} overflow="auto">
            <Box component="table" sx={{ borderCollapse: "separate", borderSpacing: 0, width: "fit-content", minWidth: "100%" }}>
              <Box component="thead">
                <Box component="tr">
                  <Box
                    component="th"
                    sx={{
                      position: "sticky", left: 0, top: 0, zIndex: 5,
                      bgcolor: "background.paper",
                      minWidth: 200, maxWidth: 200,
                      px: 1.5, py: 1,
                      borderRight: "2px solid", borderBottom: "1px solid", borderColor: "divider",
                      textAlign: "left",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" fontWeight={600} fontSize={12}>Source ↓</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" fontSize={10} sx={{ mt: 0.25 }}>Target →</Typography>
                  </Box>
                  {cols.map((col) => <ColHeaderCell key={col.id} type={col} />)}
                </Box>
              </Box>

              <Box component="tbody">
                {rows.map((row) => (
                  <Box component="tr" key={row.id}>
                    <Box
                      component="td"
                      sx={{
                        position: "sticky", left: 0, zIndex: 1,
                        bgcolor: "background.paper",
                        minWidth: 200, maxWidth: 200,
                        px: 1.5, py: 0.75,
                        borderRight: "2px solid", borderBottom: "1px solid", borderColor: "divider",
                      }}
                    >
                      <TypeLabel type={row} align="left" />
                    </Box>
                    {cols.map((col) => {
                      const { forward, reverse } = cellOf(row, col);
                      return (
                        <MatrixCell
                          key={col.id}
                          source={row}
                          target={col}
                          forward={forward}
                          reverse={reverse}
                          shown={cellShown(row, col)}
                          onCreate={() => onCreateForPair(row.kind, row.id, col.kind, col.id)}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onSwap={onSwap}
                        />
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        {hasSelection && (
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexShrink: 0, px: 0.5 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 14, height: 14, bgcolor: FORWARD_BG, border: "1px solid #C7D2FE", borderRadius: 0.5 }} />
              <Typography variant="caption" color="text.secondary">Source → Target (editable)</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 14, height: 14, bgcolor: REVERSE_BG, border: "1px dashed", borderColor: "grey.400", borderRadius: 0.5 }} />
              <Typography variant="caption" color="text.secondary">Opposite direction (read-only — swap to edit)</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 14, height: 14, border: "1px solid", borderColor: "divider", borderRadius: 0.5 }} />
              <Typography variant="caption" color="text.secondary">Empty — click to create</Typography>
            </Stack>
          </Stack>
        )}

        <AnyTypesPanel governed={anyTypes} onEdit={onEdit} onDelete={onDelete} />
      </Box>
    </Box>
  );
}
