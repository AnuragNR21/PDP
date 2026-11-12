import { renderSelection, type SelectionSlot } from "@/shared/workspace/SelectionSlot";
import { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Divider, IconButton, MenuItem, MenuList, Popover, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SwapHorizOutlined from "@mui/icons-material/SwapHorizOutlined";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/shared/toast/ToastContext";
import {
  CROSS_MODEL_SELECTION_LEVEL,
  getCrossModelSelectionKey,
  type CrossModelSelectableItem,
} from "@/features/cross-model";
import {
  useActiveCrossModelRelationshipTypes,
  useAllCrossModelLinks,
  useCreateCrossModelLink,
  useCrossModelSelectionModels,
  useDeleteCrossModelLink,
  useHierarchyModels,
  useSupportDomainModels,
  useUpdateCrossModelLink,
} from "@/features/structure/state/useStructureWorkspace";
import type { CrossModelInstance } from "@/features/structure/api/structureApi";
import type { CrossModelRelationshipTypeSummary } from "@/features/model/domain/types";
import { modelDefinitionsApi } from "@/features/model/api/modelDefinitionsApi";
import { useStructureWorkspace } from "../contexts/StructureWorkspaceContext";
import { InstanceSelectionPanel } from "./workspace/InstanceSelectionPanel";
import { LifecycleChip } from "./workspace/lifecycle";
import { instanceContexts, uniqueById } from "@/features/structure/domain/instanceContext";

/**
 * Which cells the matrix shows — the same choice, and the same words, as the
 * MWS Relationship Matrix. Presentation only; it never changes data.
 */
export type InstanceMatrixCellFilter = "forward" | "any" | "all";
export const INSTANCE_MATRIX_CELL_FILTER_LABEL: Record<InstanceMatrixCellFilter, string> = {
  forward: "Source → Target relationships",
  any: "With any relationship",
  all: "All possible",
};

/** The MWS Relationship Matrix colours. */
const FORWARD_BG = "#EEF4FF";
const REVERSE_BG = "#F5F5F5";
const NOT_ALLOWED_BG = "repeating-linear-gradient(135deg, #F3F4F6 0 6px, #ECEDEF 6px 12px)";

type Row = CrossModelSelectableItem;

/** Governed types that allow a link from `source` to `target`, in that direction. */
function allowedTypes(types: CrossModelRelationshipTypeSummary[], source: Row, target: Row) {
  if (source.id === target.id) return [];
  return types.filter(
    (type) =>
      type.sourceModelType === source.modelKind &&
      type.targetModelType === target.modelKind &&
      (type.sourceModelItemTypeId === null ? type.sourceModelId === null || type.sourceModelId === source.modelId : type.sourceModelItemTypeId === source.typeId) &&
      (type.targetModelItemTypeId === null ? type.targetModelId === null || type.targetModelId === target.modelId : type.targetModelItemTypeId === target.typeId),
  );
}

function CellPopover(props: {
  anchorEl: HTMLElement;
  row: Row;
  col: Row;
  forward?: CrossModelInstance;
  reverse?: CrossModelInstance;
  options: CrossModelRelationshipTypeSummary[];
  reverseOptions: CrossModelRelationshipTypeSummary[];
  nameOf: (typeId: string) => string;
  onClose: () => void;
  onCreate: (typeId: string) => void;
  onRetype: (typeId: string) => void;
  onDelete: () => void;
  onSwap: () => void;
}) {
  const { row, col, forward, reverse } = props;
  const others = forward ? props.options.filter((type) => type.id !== forward.relationship_rule_id) : [];
  return (
    <Popover
      open
      anchorEl={props.anchorEl}
      onClose={props.onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      PaperProps={{ sx: { minWidth: 240, maxWidth: 340, p: 1.5, borderRadius: 2 } }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {row.name} → {col.name}
      </Typography>
      <Divider sx={{ my: 1 }} />

      {!forward && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5, fontSize: 12 }}>
          {props.options.length > 0 ? "No relationship in this direction yet." : "The model allows no relationship in this direction."}
        </Typography>
      )}
      {forward && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.25 }}>
          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{props.nameOf(forward.relationship_rule_id)}</Typography>
          <Tooltip title={`Delete ${props.nameOf(forward.relationship_rule_id)}`}>
            <IconButton size="small" color="error" aria-label={`Delete ${props.nameOf(forward.relationship_rule_id)}`} onClick={() => { props.onDelete(); props.onClose(); }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
      {forward && others.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            Change to another relationship the model allows:
          </Typography>
          <MenuList dense disablePadding>
            {others.map((type) => (
              <MenuItem key={type.id} onClick={() => { props.onRetype(type.id); props.onClose(); }} sx={{ fontSize: 12, borderRadius: 1 }}>
                {type.name}
              </MenuItem>
            ))}
          </MenuList>
        </>
      )}

      {(reverse || (!forward && props.options.length === 0 && props.reverseOptions.length > 0)) && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" fontWeight={700} display="block">
            Opposite direction — {col.name} → {row.name}
          </Typography>
          {reverse ? (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: 12, py: 0.25 }}>{props.nameOf(reverse.relationship_rule_id)}</Typography>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: 12, py: 0.25 }}>
              The model allows {props.reverseOptions.map((type) => type.name).join(", ")} this way.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Read-only here. Swap Source / Target to {reverse ? "edit it" : "create it"} in its own direction.
          </Typography>
          <Button size="small" startIcon={<SwapHorizOutlined />} onClick={() => { props.onSwap(); props.onClose(); }} sx={{ mt: 0.5 }}>
            Swap Source / Target
          </Button>
        </>
      )}

      {!forward && props.options.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
            {props.options.length > 1 ? "Choose the relationship to create:" : "Create:"}
          </Typography>
          <MenuList dense disablePadding>
            {props.options.map((type) => (
              <MenuItem key={type.id} onClick={() => { props.onCreate(type.id); props.onClose(); }} sx={{ fontSize: 12, borderRadius: 1 }}>
                <AddIcon sx={{ fontSize: 14, mr: 1 }} /> {row.name} → {type.name} → {col.name}
              </MenuItem>
            ))}
          </MenuList>
        </>
      )}
    </Popover>
  );
}

function MatrixCell(props: {
  row: Row;
  col: Row;
  forward?: CrossModelInstance;
  reverse?: CrossModelInstance;
  options: CrossModelRelationshipTypeSummary[];
  reverseOptions: CrossModelRelationshipTypeSummary[];
  /** Why no new relationship may be made here because of lifecycle, if that is why. */
  blocked?: string | null;
  shown: boolean;
  pending: boolean;
  nameOf: (typeId: string) => string;
  onCreate: (typeId: string) => void;
  onRetype: (typeId: string) => void;
  onDelete: () => void;
  onSwap: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { row, col, forward, reverse, options } = props;
  const empty = !forward && !reverse;
  const tdSx = { p: 0, textAlign: "center", borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" } as const;

  if (!props.shown) return <Box component="td" sx={tdSx}><Box sx={{ minWidth: 120, minHeight: 48 }} /></Box>;

  // Nothing here and nothing the model allows from this row to this column.
  if (empty && options.length === 0) {
    const otherWay = props.reverseOptions.length > 0;
    return (
      <Box component="td" sx={tdSx}>
        <Tooltip
          title={
            props.blocked
              ? `${props.blocked} — no new relationship can be created here.`
              : otherWay
              ? `The model allows ${props.reverseOptions.map((type) => type.name).join(", ")} only from ${col.name} to ${row.name}. Swap Source / Target to create it.`
              : `The model allows no relationship between ${row.typeName || row.name} and ${col.typeName || col.name}.`
          }
        >
          <Box
            role={otherWay && !props.blocked ? "button" : undefined}
            aria-label={`Not allowed ${row.name} to ${col.name}`}
            onClick={otherWay && !props.blocked ? (event) => setAnchorEl(event.currentTarget) : undefined}
            sx={{ minWidth: 120, minHeight: 48, background: NOT_ALLOWED_BG, cursor: otherWay && !props.blocked ? "pointer" : "not-allowed" }}
          />
        </Tooltip>
        {anchorEl && (
          <CellPopover
            anchorEl={anchorEl}
            row={row}
            col={col}
            options={options}
            reverseOptions={props.reverseOptions}
            nameOf={props.nameOf}
            onClose={() => setAnchorEl(null)}
            onCreate={props.onCreate}
            onRetype={props.onRetype}
            onDelete={props.onDelete}
            onSwap={props.onSwap}
          />
        )}
      </Box>
    );
  }

  const bg = forward ? FORWARD_BG : reverse ? REVERSE_BG : "transparent";
  const createAtOnce = empty && options.length === 1;
  return (
    <>
      <Box component="td" data-cell={`${row.id}>${col.id}`} sx={tdSx}>
        <Box
          role="button"
          aria-label={empty ? `Create relationship ${row.name} to ${col.name}` : `Relationships ${row.name} to ${col.name}`}
          onClick={(event) => {
            if (props.pending) return;
            if (createAtOnce) props.onCreate(options[0].id);
            else setAnchorEl(event.currentTarget);
          }}
          sx={{
            minWidth: 120, minHeight: 48, cursor: props.pending ? "default" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 0.5, p: 0.75,
            bgcolor: bg,
            "&:hover": { bgcolor: "action.hover" },
            "&:hover .pdp-cell-plus": { opacity: 0.45 },
            transition: "background 0.12s",
          }}
        >
          {props.pending ? (
            <CircularProgress size={16} />
          ) : (
            <>
              {empty && options.length === 1 && <Box className="pdp-cell-plus" sx={{ opacity: 0, fontSize: 18, lineHeight: 1 }}>+</Box>}
              {empty && options.length > 1 && (
                <Tooltip title={`The model allows ${options.length} relationships here: ${options.map((type) => type.name).join(", ")}. Click to choose one.`}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, border: "1px dashed", borderColor: "divider", borderRadius: 1, px: 0.75 }}>
                    + {options.length} options
                  </Typography>
                </Tooltip>
              )}
              {forward && (
                <Chip
                  label={props.nameOf(forward.relationship_rule_id)}
                  size="small"
                  sx={{
                    fontSize: 10, height: 18, bgcolor: "#EEF2FF", color: "#3730A3",
                    fontWeight: 700, border: "1px solid #C7D2FE", pointerEvents: "none", maxWidth: 160,
                    ".MuiChip-label": { px: "6px" },
                  }}
                />
              )}
              {reverse && (
                <Tooltip title={`${props.nameOf(reverse.relationship_rule_id)}: ${col.name} → ${row.name} (opposite direction, read-only here)`}>
                  <Chip
                    label={`← ${props.nameOf(reverse.relationship_rule_id)}`}
                    size="small"
                    sx={{
                      fontSize: 10, height: 18, bgcolor: "#FAFAFA", color: "text.disabled",
                      fontWeight: 600, border: "1px dashed", borderColor: "grey.400", maxWidth: 160,
                      ".MuiChip-label": { px: "6px" },
                    }}
                  />
                </Tooltip>
              )}
            </>
          )}
        </Box>
      </Box>
      {anchorEl && (
        <CellPopover
          anchorEl={anchorEl}
          row={row}
          col={col}
          forward={forward}
          reverse={reverse}
          options={options}
          reverseOptions={props.reverseOptions}
          nameOf={props.nameOf}
          onClose={() => setAnchorEl(null)}
          onCreate={props.onCreate}
          onRetype={props.onRetype}
          onDelete={props.onDelete}
          onSwap={props.onSwap}
        />
      )}
    </>
  );
}

function HeaderLabel({ item, align, context }: { item: Row; align: "left" | "center"; context?: string }) {
  // "Asset Property of Pole" when the name alone is shared with other instances.
  const typeLabel = context ? `${item.typeName} of ${context}` : item.typeName;
  return (
    <Tooltip title={`${item.name} · ${typeLabel} — ${item.modelName}`} placement={align === "left" ? "right" : "top"}>
      <Box sx={{ overflow: "hidden", textAlign: align }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, justifyContent: align === "center" ? "center" : "flex-start", minWidth: 0 }}>
          <Typography variant="caption" display="block" fontWeight={600} noWrap sx={{ fontSize: 12, color: item.lifecycle === "retired" ? "text.secondary" : undefined }}>{item.name}</Typography>
          <LifecycleChip status={item.lifecycle} />
        </Box>
        <Typography variant="caption" display="block" color="text.secondary" noWrap sx={{ fontSize: 10 }}>
          {typeLabel} · {item.modelName}
        </Typography>
      </Box>
    </Tooltip>
  );
}

/**
 * SWS › Relationship › Matrix — the MWS Relationship Matrix (PDP-234) for
 * instances. Item Selection picks Source instances as rows and Target
 * instances as columns (Model → Type → Instance). A cell holds the link from its
 * row to its column (blue, editable) and any link the other way (grey ←, read
 * only — swap to edit). An empty cell is open only where a governed MWS
 * relationship type allows its row's type → its column's type: one type is
 * used at once, several are offered to choose from, and nothing else can be
 * made. A hatched cell is a pair the model does not relate in this direction.
 * Swapping turns the matrix round; it never reverses a relationship.
 */
export function CrossModelMatrixView(props: {
  selectionSlot?: SelectionSlot;
  cellFilter?: InstanceMatrixCellFilter;
  /** Show and create only this governed relationship type; null for all. */
  relationshipTypeId?: string | null;
  /** Defaults to swapping the Source and Target selections. */
  onSwap?: () => void;
} = {}) {
  const cellFilter = props.cellFilter ?? "all";
  const relationshipTypeId = props.relationshipTypeId ?? null;
  const {
    crossModelRelationship: {
      matrixViewSelection: { sourceSelection, targetSelection },
    },
    setMatrixSourceSelection,
    setMatrixTargetSelection,
  } = useStructureWorkspace();

  const swap = props.onSwap ?? (() => {
    setMatrixSourceSelection(targetSelection);
    setMatrixTargetSelection(sourceSelection);
  });
  const { showToast } = useToast();
  const createLink = useCreateCrossModelLink();
  const updateLink = useUpdateCrossModelLink();
  const deleteLink = useDeleteCrossModelLink();
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const governedQuery = useActiveCrossModelRelationshipTypes();
  const allGoverned = useMemo(() => governedQuery.data ?? [], [governedQuery.data]);
  const governed = useMemo(
    () => (relationshipTypeId ? allGoverned.filter((type) => type.id === relationshipTypeId) : allGoverned),
    [allGoverned, relationshipTypeId],
  );
  const nameOf = (typeId: string) => allGoverned.find((type) => type.id === typeId)?.name ?? "Relationship";

  const allLinks = useAllCrossModelLinks();
  const selectionModels = useCrossModelSelectionModels();
  const typeOptionsQuery = useQuery({ queryKey: ["cross-model-type-options"], queryFn: () => modelDefinitionsApi.getCrossModelTypeOptions() });
  const typeOptions = useMemo(() => [...(typeOptionsQuery.data?.nodeTypes ?? []), ...(typeOptionsQuery.data?.elementTypes ?? [])], [typeOptionsQuery.data]);
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const modelStatus = useMemo(
    () => new Map([...(hierarchyModels.data ?? []), ...(supportModels.data ?? [])].map((model) => [model.id, model.status as string])),
    [hierarchyModels.data, supportModels.data],
  );

  const itemByKey = useMemo(
    () => new Map(selectionModels.flatMap((model) => model.items).map((item) => [getCrossModelSelectionKey(item), item])),
    [selectionModels],
  );
  const contexts = useMemo(() => instanceContexts(selectionModels.flatMap((model) => model.items)), [selectionModels]);
  // Each instance once as a row or column, even if the selection lists it twice.
  const hydrate = (selection: typeof sourceSelection) =>
    uniqueById(selection?.instances ?? []).flatMap((instance) => {
      const item = itemByKey.get(getCrossModelSelectionKey({ id: instance.id, level: CROSS_MODEL_SELECTION_LEVEL.INSTANCE, modelKind: instance.kind }));
      return item ? [item] : [];
    });
  const sourceItems = hydrate(sourceSelection);
  const targetItems = hydrate(targetSelection);

  const apply = (items: CrossModelSelectableItem[], setter: typeof setMatrixSourceSelection) =>
    setter(items.length === 0 ? null : { instances: items.map((item) => ({ id: item.id, name: item.name, modelId: item.modelId, modelName: item.modelName, kind: item.modelKind })) });

  // One stored link per ordered pair of instances.
  const linkByPair = useMemo(() => {
    const map = new Map<string, CrossModelInstance>();
    const shownTypes = new Set(governed.map((type) => type.id));
    for (const link of allLinks.data ?? []) {
      if (relationshipTypeId && !shownTypes.has(link.relationship_rule_id)) continue;
      map.set(`${link.source_instance_id}>${link.target_instance_id}`, link);
    }
    return map;
  }, [allLinks.data, governed, relationshipTypeId]);

  const cellOf = (row: Row, col: Row) => {
    const same = row.id === col.id;
    // Lifecycle: an Archived instance, or one whose model or type is not
    // Active, keeps its relationships but takes no new ones.
    const blocked = row.authorable === false
      ? `${row.name}: ${row.lifecycleReason}`
      : col.authorable === false
        ? `${col.name}: ${col.lifecycleReason}`
        : null;
    return {
      forward: same ? undefined : linkByPair.get(`${row.id}>${col.id}`),
      reverse: same ? undefined : linkByPair.get(`${col.id}>${row.id}`),
      options: blocked ? [] : allowedTypes(governed, row, col),
      reverseOptions: blocked ? [] : allowedTypes(governed, col, row),
      blocked,
    };
  };
  const cellShown = (row: Row, col: Row) => {
    if (cellFilter === "all") return true;
    const { forward, reverse } = cellOf(row, col);
    return cellFilter === "forward" ? Boolean(forward) : Boolean(forward || reverse);
  };
  const rows = cellFilter === "all" ? sourceItems : sourceItems.filter((row) => targetItems.some((col) => cellShown(row, col)));
  const cols = cellFilter === "all" ? targetItems : targetItems.filter((col) => sourceItems.some((row) => cellShown(row, col)));

  const run = async (cell: string, action: () => Promise<unknown>, done: string, failed: string) => {
    setPendingCell(cell);
    try {
      await action();
      showToast(done);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail ?? (error instanceof Error ? error.message : failed), "error");
    } finally {
      setPendingCell(null);
    }
  };
  const create = (row: Row, col: Row, typeId: string) =>
    run(
      `${row.id}>${col.id}`,
      () => createLink.mutateAsync({ relationship_rule_id: typeId, source_instance_id: row.id, source_instance_type: row.modelKind, target_instance_id: col.id, target_instance_type: col.modelKind }),
      `${row.name} → ${nameOf(typeId)} → ${col.name}.`,
      "Could not create the relationship.",
    );
  const retype = (row: Row, col: Row, link: CrossModelInstance, typeId: string) =>
    run(
      `${row.id}>${col.id}`,
      () => updateLink.mutateAsync({ crossModelInstanceId: link.cross_model_instance_id, payload: { relationship_rule_id: typeId } }),
      `Changed to ${nameOf(typeId)}.`,
      "Could not change the relationship.",
    );
  const remove = (row: Row, col: Row, link: CrossModelInstance) =>
    run(`${row.id}>${col.id}`, () => deleteLink.mutateAsync({ crossModelInstanceId: link.cross_model_instance_id }), "Relationship deleted.", "Could not delete the relationship.");

  const hasSelection = sourceItems.length > 0 && targetItems.length > 0;

  return (
    <Box display="flex" flex={1} minHeight={0} gap={1.5}>
      {renderSelection(props.selectionSlot, (
        <InstanceSelectionPanel
          models={selectionModels}
          typeOptions={typeOptions}
          modelStatus={modelStatus}
          source={sourceItems}
          target={targetItems}
          onSourceChange={(items) => apply(items, setMatrixSourceSelection)}
          onTargetChange={(items) => apply(items, setMatrixTargetSelection)}
          onSwap={swap}
        />
      ), 360)}

      <Box display="flex" flexDirection="column" flex={1} minWidth={0} minHeight={0} gap={1}>
        {allLinks.isError && <Alert severity="error">Could not load relationships.</Alert>}

        {!hasSelection && (
          <Box flex={1} display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={1} sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, py: 8, px: 4, bgcolor: "action.hover" }}>
            <Typography variant="body1" fontWeight={600} color="text.secondary">Select Source and Target instances to build the matrix</Typography>
            <Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", maxWidth: 520 }}>
              Pick <strong>Source rows</strong> and <strong>Target columns</strong> in Item Selection — single instances, a whole type or a whole model.
              Click an open cell to relate the two instances with a relationship the Model Workspace allows.
            </Typography>
          </Box>
        )}

        {hasSelection && (allLinks.isLoading || governedQuery.isLoading) && (
          <Stack direction="row" alignItems="center" gap={1} px={1}><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Loading…</Typography></Stack>
        )}

        {hasSelection && !allLinks.isLoading && (rows.length === 0 || cols.length === 0) && (
          <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, py: 6, px: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">No cells match “{INSTANCE_MATRIX_CELL_FILTER_LABEL[cellFilter]}” for the selected instances.</Typography>
            <Typography variant="caption" color="text.disabled">Choose “All possible” to see every Source × Target cell and create a relationship.</Typography>
          </Box>
        )}

        {hasSelection && !allLinks.isLoading && rows.length > 0 && cols.length > 0 && (
          <Box flex={1} minHeight={0} overflow="auto">
            <Box component="table" sx={{ borderCollapse: "separate", borderSpacing: 0, width: "fit-content", minWidth: "100%" }}>
              <Box component="thead">
                <Box component="tr">
                  <Box
                    component="th"
                    sx={{ position: "sticky", left: 0, top: 0, zIndex: 5, bgcolor: "background.paper", minWidth: 200, maxWidth: 200, px: 1.5, py: 1, borderRight: "2px solid", borderBottom: "1px solid", borderColor: "divider", textAlign: "left" }}
                  >
                    <Typography variant="caption" color="text.secondary" fontWeight={600} fontSize={12}>Source ↓</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" fontSize={10} sx={{ mt: 0.25 }}>Target →</Typography>
                  </Box>
                  {cols.map((col) => (
                    <Box
                      component="th"
                      key={col.id}
                      sx={{ position: "sticky", top: 0, zIndex: 3, bgcolor: "background.paper", minWidth: 130, maxWidth: 160, px: 1, py: 0.75, borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" }}
                    >
                      <HeaderLabel item={col} align="center" context={contexts.get(col.id)} />
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((row) => (
                  <Box component="tr" key={row.id}>
                    <Box
                      component="td"
                      sx={{ position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper", minWidth: 200, maxWidth: 200, px: 1.5, py: 0.75, borderRight: "2px solid", borderBottom: "1px solid", borderColor: "divider" }}
                    >
                      <HeaderLabel item={row} align="left" context={contexts.get(row.id)} />
                    </Box>
                    {cols.map((col) => {
                      const cell = cellOf(row, col);
                      return (
                        <MatrixCell
                          key={col.id}
                          row={row}
                          col={col}
                          forward={cell.forward}
                          reverse={cell.reverse}
                          options={cell.options}
                          reverseOptions={cell.reverseOptions}
                          blocked={cell.blocked}
                          shown={cellShown(row, col)}
                          pending={pendingCell === `${row.id}>${col.id}`}
                          nameOf={nameOf}
                          onCreate={(typeId) => void create(row, col, typeId)}
                          onRetype={(typeId) => cell.forward && void retype(row, col, cell.forward, typeId)}
                          onDelete={() => cell.forward && void remove(row, col, cell.forward)}
                          onSwap={swap}
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
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexShrink: 0, px: 0.5, flexWrap: "wrap", rowGap: 0.5 }} useFlexGap>
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
              <Typography variant="caption" color="text.secondary">Allowed, empty — click to create</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 14, height: 14, background: NOT_ALLOWED_BG, border: "1px solid", borderColor: "divider", borderRadius: 0.5 }} />
              <Typography variant="caption" color="text.secondary">Not allowed by the model</Typography>
            </Stack>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
