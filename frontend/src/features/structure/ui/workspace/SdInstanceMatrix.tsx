import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SwapHorizOutlined from "@mui/icons-material/SwapHorizOutlined";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  MenuList,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { SupportDomainElementSummary, SupportDomainRelationshipSummary } from "@/features/model/domain/types";
import type { ElementInstance, ElementRelationshipInstance } from "@/features/structure/api/structureApi";
import { applicableRelationships, linkableRelationships, linkKeys, relationshipKindLabel } from "./sdInstanceLinks";

/** A matrix wider or taller than this is a wall, not a view; the rest is listed in List. */
const MAX_AXIS = 60;
/** The same colours as the MWS Relationship Matrix. */
const FORWARD_BG = "#EEF4FF";
const REVERSE_BG = "#F5F5F5";

/**
 * Which cells the matrix shows — the same choice as the MWS Relationship
 * Matrix. Presentation only; it never changes data.
 */
export type SdMatrixCellFilter = "forward" | "any" | "all";
export const SD_MATRIX_CELL_FILTER_LABEL: Record<SdMatrixCellFilter, string> = {
  forward: "Source → Target relationships",
  any: "With any relationship",
  all: "All possible",
};

/**
 * What the matrix is looking at, kept by the page so the toolbar (cell filter,
 * Swap Source / Target) can sit in the panel header as it does in MWS.
 *
 * `swapped` turns the matrix round: the model's target types become the rows.
 * The relationships themselves never change direction — a cell shows the
 * links from its row to its column, editable, and any running the other way
 * read only, exactly as the MWS Relationship Matrix does.
 */
export type SdMatrixState = {
  swapped: boolean;
  /** Element types picked for the Source rows; empty means every applicable type. */
  rowTypes: string[];
  /** Element types picked for the Target columns; empty means every applicable type. */
  colTypes: string[];
  relFilter: string;
  cellFilter: SdMatrixCellFilter;
};
const INITIAL: SdMatrixState = { swapped: false, rowTypes: [], colTypes: [], relFilter: "all", cellFilter: "all" };

export function useSdMatrixState(modelId: string) {
  const [state, setState] = useState<SdMatrixState>(INITIAL);
  useEffect(() => setState(INITIAL), [modelId]);
  const patch = (next: Partial<SdMatrixState>) => setState((current) => ({ ...current, ...next }));
  // Swap the orientation and the two type filters together, as MWS swaps its Source and Target selections.
  const swap = () => setState((current) => ({ ...current, swapped: !current.swapped, rowTypes: current.colTypes, colTypes: current.rowTypes }));
  return { state, patch, swap };
}
export type SdMatrixControl = ReturnType<typeof useSdMatrixState>;

/** The panel toolbar: Swap Source / Target, as in the MWS Relationship Matrix. */
export function SdMatrixToolbar({ control }: { control: SdMatrixControl }) {
  return (
    <Button size="small" variant="outlined" startIcon={<SwapHorizOutlined />} onClick={control.swap} sx={{ whiteSpace: "nowrap" }}>
      Swap Source / Target
    </Button>
  );
}

type CellLink = { link: ElementRelationshipInstance; name: string };

function CellPopover(props: {
  anchorEl: HTMLElement;
  row: ElementInstance;
  col: ElementInstance;
  forward: CellLink[];
  reverse: CellLink[];
  canCreate: boolean;
  reverseAllowedNames: string[];
  onClose: () => void;
  onCreate: () => void;
  onRemove: (link: ElementRelationshipInstance) => void;
  onSwap: () => void;
}) {
  const { row, col } = props;
  return (
    <Popover
      open
      anchorEl={props.anchorEl}
      onClose={props.onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      PaperProps={{ sx: { minWidth: 240, maxWidth: 320, p: 1.5, borderRadius: 2 } }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {row.name} → {col.name}
      </Typography>
      <Divider sx={{ my: 1 }} />

      {props.forward.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5, fontSize: 12 }}>
          No relationship in this direction yet.
        </Typography>
      )}
      {props.forward.map(({ link, name }) => (
        <Stack key={link.relationship_instance_id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.25 }}>
          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{name}</Typography>
          <Tooltip title={`Delete ${name}`}>
            <IconButton size="small" color="error" aria-label={`Delete ${name}`} onClick={() => { props.onRemove(link); props.onClose(); }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}

      {(props.reverse.length > 0 || (props.forward.length === 0 && !props.canCreate && props.reverseAllowedNames.length > 0)) && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" fontWeight={700} display="block">
            Opposite direction — {col.name} → {row.name}
          </Typography>
          {props.reverse.map(({ link, name }) => (
            <Typography key={link.relationship_instance_id} variant="body2" color="text.disabled" sx={{ fontSize: 12, py: 0.25 }}>
              {name}
            </Typography>
          ))}
          {props.reverse.length === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: 12, py: 0.25 }}>
              The model allows {props.reverseAllowedNames.join(", ")} in this direction.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Read-only here. Swap Source / Target to {props.reverse.length > 0 ? "edit it" : "create it"} in its own direction.
          </Typography>
          <Button size="small" startIcon={<SwapHorizOutlined />} onClick={() => { props.onSwap(); props.onClose(); }} sx={{ mt: 0.5 }}>
            Swap Source / Target
          </Button>
        </>
      )}

      {props.canCreate && (
        <>
          <Divider sx={{ my: 1 }} />
          <MenuList dense disablePadding>
            <MenuItem onClick={() => { props.onCreate(); props.onClose(); }} sx={{ fontSize: 12, borderRadius: 1 }}>
              <AddIcon sx={{ fontSize: 14, mr: 1 }} /> Create Relationship {row.name} → {col.name}
            </MenuItem>
          </MenuList>
        </>
      )}
    </Popover>
  );
}

function MatrixCell(props: {
  row: ElementInstance;
  col: ElementInstance;
  forward: CellLink[];
  reverse: CellLink[];
  /** The model relates the two element types in at least one direction. */
  allowed: boolean;
  canCreate: boolean;
  reverseAllowedNames: string[];
  shown: boolean;
  onCreate: () => void;
  onRemove: (link: ElementRelationshipInstance) => void;
  onSwap: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { row, col, forward, reverse } = props;
  const empty = forward.length === 0 && reverse.length === 0;
  const tdSx = { p: 0, textAlign: "center", borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" } as const;

  if (!props.shown) return <Box component="td" sx={tdSx}><Box sx={{ minWidth: 120, minHeight: 48 }} /></Box>;
  if (!props.allowed && empty) {
    return (
      <Box component="td" sx={tdSx}>
        <Tooltip title={`The model does not relate ${row.element_type_name} and ${col.element_type_name}`}>
          <Box aria-label="Not related by the model" sx={{ minWidth: 120, minHeight: 48, bgcolor: "action.disabledBackground" }} />
        </Tooltip>
      </Box>
    );
  }
  const bg = forward.length > 0 ? FORWARD_BG : reverse.length > 0 ? REVERSE_BG : "transparent";
  return (
    <>
      <Box component="td" data-cell={`${row.instance_id}>${col.instance_id}`} sx={tdSx}>
        <Box
          role="button"
          aria-label={empty && props.canCreate ? `Create relationship ${row.name} to ${col.name}` : `Relationships ${row.name} to ${col.name}`}
          onClick={(event) => (empty && props.canCreate ? props.onCreate() : setAnchorEl(event.currentTarget))}
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
          {empty && props.canCreate && <Box className="pdp-cell-plus" sx={{ opacity: 0, fontSize: 18, lineHeight: 1 }}>+</Box>}
          {forward.map(({ link, name }) => (
            <Chip
              key={link.relationship_instance_id}
              label={name}
              size="small"
              sx={{
                fontSize: 10, height: 18, bgcolor: "#EEF2FF", color: "#3730A3",
                fontWeight: 700, border: "1px solid #C7D2FE", pointerEvents: "none", maxWidth: 160,
                ".MuiChip-label": { px: "6px" },
              }}
            />
          ))}
          {reverse.map(({ link, name }) => (
            <Tooltip key={link.relationship_instance_id} title={`${name}: ${col.name} → ${row.name} (opposite direction, read-only here)`}>
              <Chip
                label={`← ${name}`}
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
      </Box>
      {anchorEl && (
        <CellPopover
          anchorEl={anchorEl}
          row={row}
          col={col}
          forward={forward}
          reverse={reverse}
          canCreate={props.canCreate}
          reverseAllowedNames={props.reverseAllowedNames}
          onClose={() => setAnchorEl(null)}
          onCreate={props.onCreate}
          onRemove={props.onRemove}
          onSwap={props.onSwap}
        />
      )}
    </>
  );
}

function TypeFilter(props: {
  label: string;
  options: SupportDomainElementSummary[];
  counts: Map<string, number>;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = props.options.filter((type) => props.value.includes(type.id));
  return (
    <Autocomplete
      multiple
      size="small"
      limitTags={2}
      disableCloseOnSelect
      options={props.options}
      value={selected}
      getOptionLabel={(type) => type.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_event, next) => props.onChange(next.map((type) => type.id))}
      renderOption={(optionProps, type) => {
        const { key, ...rest } = optionProps as typeof optionProps & { key: string };
        return (
          <li key={key} {...rest}>
            <Typography variant="body2" sx={{ flex: 1 }}>{type.name}</Typography>
            <Typography variant="caption" color="text.secondary">{props.counts.get(type.id) ?? 0}</Typography>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={props.label} placeholder={selected.length === 0 ? "All applicable types" : undefined} />
      )}
      sx={{ minWidth: 240, maxWidth: 360, flex: 1 }}
    />
  );
}

/**
 * SWS › Support Domain Matrix — the instance-level counterpart of the MWS
 * Relationship Matrix. Rows are Source instances, columns Target instances. A
 * cell shows the links drawn from its row to its column (blue,
 * editable) and any running the other way (grey ← chip, read only — swap to edit
 * it), named exactly as the model names the relationship.
 *
 * A link can only be created where the model defines a relationship from the
 * row's element type to the column's, in that direction: one is used at once,
 * several are offered to choose from. A shaded cell is a pair of element types
 * the model does not relate.
 */
export function SdInstanceMatrix(props: {
  control: SdMatrixControl;
  elementTypes: SupportDomainElementSummary[];
  modelRelationships: SupportDomainRelationshipSummary[];
  instances: ElementInstance[];
  links: ElementRelationshipInstance[];
  selectedInstanceId: string | null;
  onSelectInstance: (instance: ElementInstance) => void;
  onLink: (source: ElementInstance, target: ElementInstance, onlyRelationshipId?: string) => void;
  onRemoveLink: (link: ElementRelationshipInstance) => void;
}) {
  const { state, patch, swap } = props.control;
  const typeName = useMemo(() => new Map(props.elementTypes.map((type) => [type.id, type.name])), [props.elementTypes]);
  const byType = useMemo(() => {
    const map = new Map<string, ElementInstance[]>();
    for (const instance of props.instances) map.set(instance.element_type_id, [...(map.get(instance.element_type_id) ?? []), instance]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [props.instances]);
  const counts = useMemo(() => new Map(Array.from(byType, ([id, list]) => [id, list.length])), [byType]);
  const relName = useMemo(() => new Map(props.modelRelationships.map((rel) => [rel.id, relationshipKindLabel(rel.relationshipKind)])), [props.modelRelationships]);

  // Only the model relationships whose two ends both have instances relate anything.
  const live = useMemo(
    () => props.modelRelationships.filter((rel) => (counts.get(rel.sourceElementId) ?? 0) > 0 && (counts.get(rel.targetElementId) ?? 0) > 0),
    [props.modelRelationships, counts],
  );
  useEffect(() => {
    if (state.relFilter !== "all" && !live.some((rel) => rel.id === state.relFilter)) patch({ relFilter: "all" });
  }, [live, state.relFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownRels = useMemo(() => (state.relFilter === "all" ? live : live.filter((rel) => rel.id === state.relFilter)), [live, state.relFilter]);
  const shownRelIds = useMemo(() => new Set(shownRels.map((rel) => rel.id)), [shownRels]);
  const existing = useMemo(() => linkKeys(props.links), [props.links]);

  // Element types the two axes can hold: sources down the side, targets across — or the other way round when swapped.
  const sourceTypeIds = useMemo(() => new Set(shownRels.map((rel) => rel.sourceElementId)), [shownRels]);
  const targetTypeIds = useMemo(() => new Set(shownRels.map((rel) => rel.targetElementId)), [shownRels]);
  const rowApplicable = state.swapped ? targetTypeIds : sourceTypeIds;
  const colApplicable = state.swapped ? sourceTypeIds : targetTypeIds;
  const typesWithInstances = useMemo(
    () => props.elementTypes.filter((type) => (counts.get(type.id) ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [props.elementTypes, counts],
  );
  const pickTypes = (picked: string[], applicable: Set<string>) =>
    (picked.length > 0 ? typesWithInstances.filter((type) => picked.includes(type.id)) : typesWithInstances.filter((type) => applicable.has(type.id))).map((type) => type.id);
  const rowTypeIds = pickTypes(state.rowTypes, rowApplicable);
  const colTypeIds = pickTypes(state.colTypes, colApplicable);

  // Model relationships per element type pair, and stored links per instance pair.
  const relsByTypePair = useMemo(() => {
    const map = new Map<string, SupportDomainRelationshipSummary[]>();
    for (const rel of shownRels) {
      const key = `${rel.sourceElementId}>${rel.targetElementId}`;
      map.set(key, [...(map.get(key) ?? []), rel]);
    }
    return map;
  }, [shownRels]);
  const linksByPair = useMemo(() => {
    const map = new Map<string, CellLink[]>();
    for (const link of props.links) {
      if (!shownRelIds.has(link.support_domain_relationship_id)) continue;
      const key = `${link.source_instance_id}>${link.target_instance_id}`;
      map.set(key, [...(map.get(key) ?? []), { link, name: relName.get(link.support_domain_relationship_id) ?? relationshipKindLabel(link.relationship_type) }]);
    }
    return map;
  }, [props.links, shownRelIds, relName]);
  const linkable = useMemo(() => linkableRelationships(shownRels), [shownRels]);

  const cellOf = (row: ElementInstance, col: ElementInstance) => {
    const same = row.instance_id === col.instance_id;
    const forward = same ? [] : linksByPair.get(`${row.instance_id}>${col.instance_id}`) ?? [];
    const reverse = same ? [] : linksByPair.get(`${col.instance_id}>${row.instance_id}`) ?? [];
    const forwardRels = same ? [] : relsByTypePair.get(`${row.element_type_id}>${col.element_type_id}`) ?? [];
    const reverseRels = same ? [] : relsByTypePair.get(`${col.element_type_id}>${row.element_type_id}`) ?? [];
    return {
      forward,
      reverse,
      allowed: forwardRels.length + reverseRels.length > 0,
      canCreate: applicableRelationships(linkable, existing, row, col).length > 0,
      reverseAllowedNames: reverseRels.map((rel) => relationshipKindLabel(rel.relationshipKind)),
    };
  };
  const cellShown = (row: ElementInstance, col: ElementInstance) => {
    if (state.cellFilter === "all") return true;
    const { forward, reverse } = cellOf(row, col);
    return state.cellFilter === "forward" ? forward.length > 0 : forward.length + reverse.length > 0;
  };

  const allRows = rowTypeIds.flatMap((id) => byType.get(id) ?? []);
  const allCols = colTypeIds.flatMap((id) => byType.get(id) ?? []);
  const filteredRows = state.cellFilter === "all" ? allRows : allRows.filter((row) => allCols.some((col) => cellShown(row, col)));
  const filteredCols = state.cellFilter === "all" ? allCols : allCols.filter((col) => allRows.some((row) => cellShown(row, col)));
  const rows = filteredRows.slice(0, MAX_AXIS);
  const cols = filteredCols.slice(0, MAX_AXIS);
  const truncated = filteredRows.length > rows.length || filteredCols.length > cols.length;
  const linkCount = Array.from(linksByPair.values()).reduce((sum, list) => sum + list.length, 0);

  if (props.modelRelationships.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        This model defines no relationships between its element types, so its instances cannot be related. Define them in the Model Workspace.
      </Typography>
    );
  }
  if (live.length === 0) {
    const missing = Array.from(
      new Set(props.modelRelationships.flatMap((rel) => [rel.sourceElementId, rel.targetElementId]).filter((id) => !counts.has(id))),
    ).map((id) => typeName.get(id) ?? id);
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No instances can be related yet. Every relationship in this model involves an element type with no instances
        {missing.length > 0 ? ` (${missing.join(", ")})` : ""} — add instances of it first.
      </Typography>
    );
  }

  const describe = (rel: SupportDomainRelationshipSummary) =>
    `${typeName.get(rel.sourceElementId) ?? "?"} → ${relationshipKindLabel(rel.relationshipKind)} → ${typeName.get(rel.targetElementId) ?? "?"}`;
  const header = (instance: ElementInstance, align: "left" | "center") => (
    <Box onClick={() => props.onSelectInstance(instance)} sx={{ cursor: "pointer", textAlign: align, fontWeight: instance.instance_id === props.selectedInstanceId ? 700 : 600 }}>
      <Typography variant="body2" fontWeight="inherit" fontSize={12} noWrap title={instance.name}>{instance.name}</Typography>
      <Typography variant="caption" color="text.secondary" fontSize={10} noWrap display="block">{typeName.get(instance.element_type_id) ?? instance.element_type_name}</Typography>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider", flexWrap: "wrap", rowGap: 1 }} useFlexGap>
        <TextField select size="small" label="Model relationship" value={state.relFilter} onChange={(event) => patch({ relFilter: event.target.value })} sx={{ minWidth: 260 }}>
          <MenuItem value="all">All relationships ({live.length})</MenuItem>
          {live.map((rel) => (
            <MenuItem key={rel.id} value={rel.id}>{describe(rel)}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Show cells"
          value={state.cellFilter}
          onChange={(event) => patch({ cellFilter: event.target.value as SdMatrixCellFilter })}
          sx={{ minWidth: 220 }}
        >
          {(Object.keys(SD_MATRIX_CELL_FILTER_LABEL) as SdMatrixCellFilter[]).map((key) => (
            <MenuItem key={key} value={key}>
              {SD_MATRIX_CELL_FILTER_LABEL[key]}
            </MenuItem>
          ))}
        </TextField>
        <TypeFilter label="Source rows" options={typesWithInstances} counts={counts} value={state.rowTypes} onChange={(rowTypes) => patch({ rowTypes })} />
        <TypeFilter label="Target columns" options={typesWithInstances} counts={counts} value={state.colTypes} onChange={(colTypes) => patch({ colTypes })} />
        <Typography variant="caption" color="text.secondary">
          {linkCount} diagram link{linkCount === 1 ? "" : "s"} drawn
        </Typography>
      </Stack>
      {truncated && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pt: 0.75 }}>
          Showing {rows.length} of {filteredRows.length} source and {cols.length} of {filteredCols.length} target instances — narrow the Source rows or Target columns, or pick one relationship.
        </Typography>
      )}
      {rows.length === 0 || cols.length === 0 ? (
        <Box sx={{ m: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 2, py: 6, px: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {state.cellFilter === "all"
              ? "No instances of the selected Source and Target element types."
              : `No cells match “${SD_MATRIX_CELL_FILTER_LABEL[state.cellFilter]}” for the selected types.`}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {state.cellFilter === "all" ? "Clear the type filters to show every applicable type." : "Choose “All possible” to see every Source × Target cell and create a relationship."}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ overflow: "auto", flex: 1, minHeight: 0, p: 1 }}>
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
                    key={col.instance_id}
                    sx={{ position: "sticky", top: 0, zIndex: 2, bgcolor: col.instance_id === props.selectedInstanceId ? "action.selected" : "background.paper", minWidth: 120, maxWidth: 180, px: 1, py: 1, borderLeft: "1px solid", borderBottom: "1px solid", borderColor: "divider" }}
                  >
                    {header(col, "center")}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row) => (
                <Box component="tr" key={row.instance_id}>
                  <Box
                    component="td"
                    sx={{ position: "sticky", left: 0, zIndex: 1, bgcolor: row.instance_id === props.selectedInstanceId ? "action.selected" : "background.paper", minWidth: 200, maxWidth: 200, px: 1.5, py: 0.75, borderRight: "2px solid", borderBottom: "1px solid", borderColor: "divider" }}
                  >
                    {header(row, "left")}
                  </Box>
                  {cols.map((col) => {
                    const cell = cellOf(row, col);
                    return (
                      <MatrixCell
                        key={col.instance_id}
                        row={row}
                        col={col}
                        forward={cell.forward}
                        reverse={cell.reverse}
                        allowed={cell.allowed}
                        canCreate={cell.canCreate}
                        reverseAllowedNames={cell.reverseAllowedNames}
                        shown={cellShown(row, col)}
                        onCreate={() => props.onLink(row, col, state.relFilter === "all" ? undefined : state.relFilter)}
                        onRemove={props.onRemoveLink}
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
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexShrink: 0, px: 1.5, py: 0.75, flexWrap: "wrap", rowGap: 0.5 }} useFlexGap>
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
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box sx={{ width: 14, height: 14, bgcolor: "action.disabledBackground", borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">Not related by the model</Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
