import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ChecklistOutlinedIcon from "@mui/icons-material/ChecklistOutlined";
import type { StructureImportValidateResponse } from "@/features/structure/api/structureApi";

/**
 * The Data Import Summary as a review workspace: one grid for every SWS Data
 * Transfer object type (hierarchy node instances, SD element instances, SD
 * instance relationships …). The columns vary by object type; sorting,
 * filtering, search, column visibility and widths, frozen key columns, paging
 * and bulk selection behave the same everywhere.
 *
 * Layout (visible columns, widths, sort, page size, wrapping) is kept per
 * object type in the browser, so re-validating or importing the next file of
 * the same kind keeps it. Filters and search last for the file under review.
 */

export type ValidationRow = StructureImportValidateResponse["rows"][number];
export type ReviewRow = { result: ValidationRow; source: Record<string, unknown> };

type FilterKind = "select" | "text";

export type ReviewColumn = {
  key: string;
  label: string;
  /** Review columns are shown by default; technical ones (IDs) start hidden. */
  technical?: boolean;
  frozen?: boolean;
  filter?: FilterKind | null;
  width: number;
  numeric?: boolean;
  /** Long text that may wrap instead of being cut off. */
  long?: boolean;
  value: (row: ReviewRow) => string;
  render?: (row: ReviewRow, wrap: boolean) => ReactNode;
};

type ColumnFilter = { values?: string[]; text?: string };
type SortState = { key: string; direction: "asc" | "desc" } | null;

type Layout = {
  hidden: string[] | null;
  widths: Record<string, number>;
  sort: SortState;
  pageSize: number;
  wrap: boolean;
};

const PAGE_SIZES = [25, 50, 100, 250];
const CHECKBOX_WIDTH = 48;
const MIN_WIDTH = 56;

export const STATUS_ACCEPTED = "Accepted";
export const STATUS_REJECTED = "Rejected";
export const STATUS_WARNING = "Warning";

const LINK_OBJECT = "support_domain_model_element_instance_relationship";

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function statusMatches(row: ValidationRow, value: string) {
  if (value === STATUS_ACCEPTED) return row.status === "accepted";
  if (value === STATUS_REJECTED) return row.status === "rejected";
  if (value === STATUS_WARNING) return row.warnings.length > 0;
  return false;
}

function loadLayout(key: string): Partial<Layout> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Layout>) : {};
  } catch {
    return {};
  }
}

function saveLayout(key: string, layout: Layout) {
  try {
    window.localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Layout memory is a convenience only.
  }
}

// ---------------------------------------------------------------- columns

function imported(key: string, label: string, options: Partial<ReviewColumn> = {}): ReviewColumn {
  return { key, label, width: 180, filter: "text", value: (row) => str(row.source[key]), ...options };
}

function statusCell(row: ReviewRow) {
  const { result } = row;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Chip
        size="small"
        color={result.status === "accepted" ? "success" : "error"}
        label={result.status}
        sx={{ height: 20, fontSize: 11 }}
      />
      {result.warnings.length > 0 && (
        <Tooltip title={result.warnings.join(" · ")}>
          <WarningAmberIcon color="warning" sx={{ fontSize: 16 }} />
        </Tooltip>
      )}
    </Stack>
  );
}

function messageCell(row: ReviewRow, wrap: boolean) {
  const { result } = row;
  return (
    <Typography
      variant="body2"
      component="span"
      sx={{
        fontSize: 13,
        color: result.status === "rejected" ? "error.main" : "text.primary",
        ...(wrap ? { whiteSpace: "normal", wordBreak: "break-word" } : {}),
      }}
    >
      {result.message}
      {result.warnings.length > 0 && (
        <Box component="span" sx={{ color: "warning.dark", display: "block", ...(wrap ? {} : { display: "inline", ml: 0.75 }) }}>
          {result.warnings.join(" · ")}
        </Box>
      )}
    </Typography>
  );
}

function baseColumns(messageLabel: string): ReviewColumn[] {
  return [
    {
      key: "row",
      label: "Row",
      frozen: true,
      numeric: true,
      width: 80,
      filter: null,
      value: (row) => String(row.result.row_number),
      render: (row) => (
        <Box
          component="span"
          sx={{
            pl: 0.75,
            borderLeft: 3,
            borderColor: row.result.status === "rejected" ? "error.main" : row.result.warnings.length ? "warning.main" : "transparent",
          }}
        >
          {row.result.row_number}
        </Box>
      ),
    },
    { key: "action", label: "Action", frozen: true, width: 112, filter: "select", value: (row) => row.result.action },
    {
      key: "status",
      label: "Status",
      frozen: true,
      width: 132,
      filter: "select",
      value: (row) => (row.result.status === "accepted" ? STATUS_ACCEPTED : STATUS_REJECTED),
      render: statusCell,
    },
  ];
}

function reviewColumns(messageLabel: string): ReviewColumn[] {
  return [
    {
      key: "message",
      label: messageLabel,
      width: 400,
      long: true,
      filter: "text",
      value: (row) => row.result.message,
      render: messageCell,
    },
    { key: "code", label: "Code", width: 170, filter: "select", value: (row) => row.result.code },
    {
      key: "warnings",
      label: "Warnings",
      width: 220,
      long: true,
      technical: true,
      filter: "text",
      value: (row) => row.result.warnings.join(" | "),
    },
  ];
}

/** Columns for one object type. `hasLinks` adds the relationship fields when SD links are in the file. */
export function columnsForImport(scope: "hierarchy" | "sd-elements" | "sd-relationships", hasLinks: boolean): ReviewColumn[] {
  const isLink = (row: ReviewRow) => row.result.object_type === LINK_OBJECT || row.source.object_type === LINK_OBJECT;

  if (scope === "hierarchy") {
    return [
      ...baseColumns("Validation Message"),
      imported("name", "Name", { frozen: true, width: 200, long: true }),
      ...reviewColumns("Validation Message"),
      imported("external_id", "External ID", { width: 150 }),
      imported("description", "Description", { width: 220, long: true, technical: true }),
      imported("parent_name", "Parent", { width: 160, technical: true }),
      imported("parent_external_id", "Parent External ID", { width: 150, technical: true }),
      imported("pdp_system_id", "PDP System ID", { width: 160, technical: true }),
      imported("parent_pdp_system_id", "Parent PDP System ID", { width: 160, technical: true }),
      imported("model_id", "Model ID", { width: 160, technical: true, filter: "select" }),
      imported("node_type_id", "Node Type ID", { width: 160, technical: true, filter: "select" }),
    ];
  }

  if (scope === "sd-relationships") {
    return [
      ...baseColumns("Validation Message"),
      {
        key: "name",
        label: "Relationship",
        frozen: true,
        width: 260,
        long: true,
        filter: "text",
        value: (row) =>
          `${str(row.source.source_element_type_name)} → ${str(row.source.relationship_type)} → ${str(row.source.target_element_type_name)}`,
      },
      ...reviewColumns("Validation Message"),
      imported("relationship_type", "Relationship Type", { width: 150, filter: "select" }),
      imported("model_name", "Model", { width: 160, filter: "select" }),
      imported("support_domain_model_id", "Model ID", { width: 160, technical: true, filter: "select" }),
      imported("source_element_type_id", "Source Type ID", { width: 160, technical: true, filter: "select" }),
      imported("target_element_type_id", "Target Type ID", { width: 160, technical: true, filter: "select" }),
    ];
  }

  const columns: ReviewColumn[] = [
    ...baseColumns("Validation Message"),
    {
      key: "name",
      label: "Name",
      frozen: true,
      width: 220,
      long: true,
      filter: "text",
      // A relationship row is named by what it links, as the SWS shows it.
      value: (row) =>
        isLink(row)
          ? `${str(row.source.source_instance_name) || "?"} → ${str(row.source.relationship_name) || "?"} → ${str(row.source.target_instance_name) || "?"}`
          : str(row.source.name),
    },
  ];
  columns.push(...reviewColumns("Validation Message"));
  if (hasLinks) {
    columns.push({
      key: "record",
      label: "Record",
      width: 110,
      filter: "select",
      value: (row) => (isLink(row) ? "Relationship" : "Instance"),
    });
  }
  columns.push(
    imported("external_id", "External ID", { width: 150 }),
    imported("description", "Description", { width: 220, long: true, technical: true }),
    imported("pdp_system_id", "PDP System ID", { width: 160, technical: true }),
    imported("support_domain_model_id", "Model ID", { width: 160, technical: true, filter: "select" }),
    imported("element_type_id", "Element Type ID", { width: 160, technical: true, filter: "select" }),
  );
  if (hasLinks) {
    columns.push(
      imported("relationship_name", "Relationship", { width: 150, technical: true, filter: "select" }),
      imported("relationship_type_id", "Relationship Type ID", { width: 160, technical: true, filter: "select" }),
      imported("source_instance_name", "Source", { width: 160, technical: true }),
      imported("source_instance_id", "Source Instance ID", { width: 160, technical: true }),
      imported("source_element_type_id", "Source Type ID", { width: 160, technical: true, filter: "select" }),
      imported("target_instance_name", "Target", { width: 160, technical: true }),
      imported("target_instance_id", "Target Instance ID", { width: 160, technical: true }),
      imported("target_element_type_id", "Target Type ID", { width: 160, technical: true, filter: "select" }),
    );
  }
  return columns;
}

// ---------------------------------------------------------------- grid

export function ImportReviewGrid(props: {
  /** Layout memory key, one per object type. */
  layoutKey: string;
  /** Changes when a different file is loaded: filters and search start again. */
  reviewKey: string;
  rows: ValidationRow[];
  importedRows: Record<string, unknown>[];
  columns: ReviewColumn[];
  selected: Set<number>;
  onSelectedChange: (next: Set<number>) => void;
  onShowFullText: (title: string, value: string) => void;
}) {
  const { columns, rows, importedRows, selected, onSelectedChange } = props;
  const storageKey = `pdp.sws.importReview.${props.layoutKey}.v1`;
  const stored = useMemo(() => loadLayout(storageKey), [storageKey]);

  const [hiddenOverride, setHiddenOverride] = useState<string[] | null>(stored.hidden ?? null);
  const [widths, setWidths] = useState<Record<string, number>>(stored.widths ?? {});
  const [sort, setSort] = useState<SortState>(stored.sort ?? null);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES.includes(stored.pageSize ?? 0) ? (stored.pageSize as number) : 25);
  const [wrap, setWrap] = useState<boolean>(stored.wrap ?? true);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  const [selectAnchor, setSelectAnchor] = useState<HTMLElement | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ el: HTMLElement; key: string } | null>(null);

  useEffect(() => {
    saveLayout(storageKey, { hidden: hiddenOverride, widths, sort, pageSize, wrap });
  }, [storageKey, hiddenOverride, widths, sort, pageSize, wrap]);

  // A different file: its own filters and search; the layout stays.
  const lastReviewKey = useRef(props.reviewKey);
  useEffect(() => {
    if (lastReviewKey.current === props.reviewKey) return;
    lastReviewKey.current = props.reviewKey;
    setFilters({});
    setSearch("");
    setPage(0);
  }, [props.reviewKey]);

  const defaultHidden = useMemo(() => columns.filter((c) => c.technical).map((c) => c.key), [columns]);
  const hidden = new Set(hiddenOverride ?? defaultHidden);
  const visibleColumns = columns.filter((column) => !hidden.has(column.key));
  // Frozen key columns first, in their own order, then the rest.
  const ordered = [...visibleColumns.filter((c) => c.frozen), ...visibleColumns.filter((c) => !c.frozen)];
  const widthOf = (column: ReviewColumn) => widths[column.key] ?? column.width;

  const reviewRows: ReviewRow[] = useMemo(
    () => rows.map((result) => ({ result, source: importedRows[result.row_number - 1] ?? {} })),
    [rows, importedRows],
  );

  const columnByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const active = Object.entries(filters).filter(([, f]) => (f.values && f.values.length) || (f.text && f.text.trim()));
    let out = reviewRows.filter((row) => {
      for (const [key, filter] of active) {
        const column = columnByKey.get(key);
        if (!column) continue;
        if (filter.values && filter.values.length) {
          if (key === "status") {
            if (!filter.values.some((value) => statusMatches(row.result, value))) return false;
          } else if (!filter.values.includes(column.value(row) || "(blank)")) return false;
        }
        if (filter.text && filter.text.trim() && !column.value(row).toLowerCase().includes(filter.text.trim().toLowerCase())) return false;
      }
      if (needle) {
        const haystack = [
          ...columns.map((column) => column.value(row)),
          ...Object.values(row.source).map(str),
        ]
          .join("\u0001")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    if (sort) {
      const column = columnByKey.get(sort.key);
      if (column) {
        const factor = sort.direction === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const left = column.value(a);
          const right = column.value(b);
          const order = column.numeric
            ? Number(left) - Number(right)
            : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
          return order === 0 ? a.result.row_number - b.result.row_number : order * factor;
        });
      }
    }
    return out;
  }, [reviewRows, filters, search, sort, columns, columnByKey]);

  const maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, maxPage);
  const pageRows = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const counts = useMemo(
    () => ({
      total: rows.length,
      accepted: rows.filter((r) => r.status === "accepted").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      warning: rows.filter((r) => r.warnings.length > 0).length,
    }),
    [rows],
  );
  const selectedAccepted = rows.filter((r) => r.status === "accepted" && selected.has(r.row_number)).length;
  const statusFilter = filters.status?.values ?? [];
  const quick = statusFilter.length === 1 ? statusFilter[0] : statusFilter.length === 0 ? "all" : null;

  function updateFilter(key: string, next: ColumnFilter | null) {
    setFilters((prev) => {
      const copy = { ...prev };
      if (!next || (!(next.values && next.values.length) && !(next.text && next.text.length))) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    setPage(0);
  }

  function setQuick(value: string) {
    updateFilter("status", value === "all" || quick === value ? null : { values: [value] });
  }

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
    setPage(0);
  }

  function select(predicate: (row: ValidationRow) => boolean, from: "all" | "filtered", replace = true) {
    const source = from === "filtered" ? filtered.map((r) => r.result) : rows;
    const next = replace ? new Set<number>() : new Set(selected);
    for (const row of source) if (predicate(row)) next.add(row.row_number);
    onSelectedChange(next);
    setSelectAnchor(null);
  }

  const filteredNumbers = filtered.map((r) => r.result.row_number);
  const allFilteredSelected = filteredNumbers.length > 0 && filteredNumbers.every((n) => selected.has(n));
  const someFilteredSelected = filteredNumbers.some((n) => selected.has(n));

  function toggleAllFiltered(checked: boolean) {
    const next = new Set(selected);
    for (const n of filteredNumbers) {
      if (checked) next.add(n);
      else next.delete(n);
    }
    onSelectedChange(next);
  }

  // Column resizing: drag the right edge of a header cell.
  function startResize(event: ReactMouseEvent, column: ReviewColumn) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const onMove = (move: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, Math.round(startWidth + move.clientX - startX));
      setWidths((prev) => ({ ...prev, [column.key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Sticky offsets of the frozen columns.
  const frozenLeft = new Map<string, number>();
  let left = CHECKBOX_WIDTH;
  let lastFrozen: string | null = null;
  for (const column of ordered) {
    if (!column.frozen) break;
    frozenLeft.set(column.key, left);
    left += widthOf(column);
    lastFrozen = column.key;
  }
  const tableWidth = CHECKBOX_WIDTH + ordered.reduce((sum, c) => sum + widthOf(c), 0);

  const stickySx = (key: string | null, header: boolean) => {
    const offset = key === null ? 0 : frozenLeft.get(key);
    if (offset === undefined) return {};
    return {
      position: "sticky",
      left: offset,
      zIndex: header ? 4 : 2,
      bgcolor: "background.paper",
      ...(key === lastFrozen ? { boxShadow: (theme: { palette: { divider: string } }) => `inset -1px 0 0 ${theme.palette.divider}, 4px 0 6px -4px rgba(0,0,0,0.18)` } : {}),
    } as const;
  };

  const filterColumn = filterAnchor ? columnByKey.get(filterAnchor.key) ?? null : null;
  const activeFilterChips = Object.entries(filters).map(([key, filter]) => {
    const column = columnByKey.get(key);
    const text = [filter.values?.join(", "), filter.text ? `contains “${filter.text}”` : ""].filter(Boolean).join(" · ");
    return { key, label: `${column?.label ?? key}: ${text}` };
  });

  if (rows.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ width: "100%", minWidth: 0 }}>
      {/* Validation summary doubles as quick filters. */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <QuickChip label={`All ${counts.total}`} active={quick === "all"} onClick={() => setQuick("all")} />
        <QuickChip label={`Accepted ${counts.accepted}`} color="success" active={quick === STATUS_ACCEPTED} onClick={() => setQuick(STATUS_ACCEPTED)} />
        <QuickChip label={`Rejected ${counts.rejected}`} color="error" active={quick === STATUS_REJECTED} onClick={() => setQuick(STATUS_REJECTED)} />
        <QuickChip label={`Warnings ${counts.warning}`} color="warning" active={quick === STATUS_WARNING} onClick={() => setQuick(STATUS_WARNING)} />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          Click a count to show only those rows.
        </Typography>
      </Stack>

      {/* Toolbar */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField
          size="small"
          placeholder="Search name, ID, message…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          sx={{ width: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Button size="small" variant="outlined" startIcon={<ChecklistOutlinedIcon />} onClick={(e) => setSelectAnchor(e.currentTarget)}>
          Select
        </Button>
        <Button size="small" variant="outlined" startIcon={<ViewColumnOutlinedIcon />} onClick={(e) => setColumnsAnchor(e.currentTarget)}>
          Columns ({visibleColumns.length}/{columns.length})
        </Button>
        <Box flex={1} />
        <Typography variant="body2" color="text.secondary">
          {selected.size} selected · <b>{selectedAccepted}</b> accepted row{selectedAccepted === 1 ? "" : "s"} will be committed
        </Typography>
      </Stack>

      {(activeFilterChips.length > 0 || search) && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary">
            Showing {filtered.length} of {rows.length}
          </Typography>
          {search && <Chip size="small" label={`Search: “${search}”`} onDelete={() => setSearch("")} />}
          {activeFilterChips.map((chip) => (
            <Chip key={chip.key} size="small" label={chip.label} onDelete={() => updateFilter(chip.key, null)} />
          ))}
          <Button
            size="small"
            onClick={() => {
              setFilters({});
              setSearch("");
              setPage(0);
            }}
          >
            Clear all
          </Button>
        </Stack>
      )}

      <TableContainer
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          maxHeight: 560,
          overflow: "auto",
          width: "100%",
          minWidth: 0,
        }}
      >
        <Table
          size="small"
          stickyHeader
          sx={{
            tableLayout: "fixed",
            width: tableWidth,
            "& th, & td": { overflow: "hidden", textOverflow: "ellipsis", px: 1 },
          }}
        >
          <colgroup>
            <col style={{ width: CHECKBOX_WIDTH }} />
            {ordered.map((column) => (
              <col key={column.key} style={{ width: widthOf(column) }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ ...stickySx(null, true), position: "sticky", left: 0, zIndex: 4, px: "0 !important", textOverflow: "clip !important" }}>
                <Tooltip title={allFilteredSelected ? "Clear the rows shown" : "Select every row shown (all pages)"}>
                  <Checkbox
                    size="small"
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected && !allFilteredSelected}
                    onChange={(event) => toggleAllFiltered(event.target.checked)}
                  />
                </Tooltip>
              </TableCell>
              {ordered.map((column) => {
                const sorted = sort?.key === column.key ? sort.direction : null;
                const filterActive = Boolean(filters[column.key]);
                return (
                  <TableCell
                    key={column.key}
                    sx={{ ...stickySx(column.key, true), whiteSpace: "nowrap", position: frozenLeft.has(column.key) ? "sticky" : "sticky", fontWeight: 600 }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 0, pr: 1 }}>
                      <Box
                        component="span"
                        onClick={() => toggleSort(column.key)}
                        title={`Sort by ${column.label}`}
                        sx={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", userSelect: "none", display: "flex", alignItems: "center", gap: 0.25, minWidth: 0 }}
                      >
                        <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {column.label}
                        </Box>
                        {sorted === "asc" && <ArrowUpwardIcon sx={{ fontSize: 14 }} />}
                        {sorted === "desc" && <ArrowDownwardIcon sx={{ fontSize: 14 }} />}
                      </Box>
                      {column.filter && (
                        <IconButton
                          size="small"
                          aria-label={`Filter ${column.label}`}
                          onClick={(event) => setFilterAnchor({ el: event.currentTarget, key: column.key })}
                          sx={{ p: 0.25, color: filterActive ? "primary.main" : "text.disabled" }}
                        >
                          <FilterListIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      )}
                    </Stack>
                    <Box
                      onMouseDown={(event) => startResize(event, column)}
                      onDoubleClick={() =>
                        setWidths((prev) => {
                          const copy = { ...prev };
                          delete copy[column.key];
                          return copy;
                        })
                      }
                      title="Drag to resize · double-click to reset"
                      sx={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        width: 6,
                        height: "100%",
                        cursor: "col-resize",
                        "&:hover": { bgcolor: "primary.light" },
                      }}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={ordered.length + 1}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No rows match the current filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((row) => {
              const number = row.result.row_number;
              return (
                <TableRow key={`${row.result.object_type}-${number}`}>
                  <TableCell padding="checkbox" sx={{ position: "sticky", left: 0, zIndex: 2, bgcolor: "background.paper", px: "0 !important", textOverflow: "clip !important" }}>
                    <Checkbox
                      size="small"
                      checked={selected.has(number)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(number);
                        else next.delete(number);
                        onSelectedChange(next);
                      }}
                    />
                  </TableCell>
                  {ordered.map((column) => {
                    const value = column.value(row);
                    const wrapThis = wrap && Boolean(column.long);
                    return (
                      <TableCell
                        key={column.key}
                        sx={{
                          ...stickySx(column.key, false),
                          whiteSpace: wrapThis ? "normal" : "nowrap",
                          verticalAlign: "top",
                          cursor: column.long ? "pointer" : undefined,
                        }}
                        onClick={column.long && value ? () => props.onShowFullText(`Row ${number} — ${column.label}`, column.key === "message" && row.result.warnings.length ? `${value}\n\nWarnings:\n${row.result.warnings.join("\n")}` : value) : undefined}
                      >
                        <Tooltip title={value && !column.render ? value : column.key === "message" ? value : ""} placement="bottom-start" enterDelay={400}>
                          <Box component="span" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {column.render ? column.render(row, wrapThis) : value || <Box component="span" sx={{ color: "text.disabled" }}>–</Box>}
                          </Box>
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={filtered.length}
        page={currentPage}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={PAGE_SIZES}
        onRowsPerPageChange={(event) => {
          setPageSize(Number(event.target.value));
          setPage(0);
        }}
        labelDisplayedRows={({ from, to, count }) =>
          `${from}–${to} of ${count}${count !== rows.length ? ` (filtered from ${rows.length})` : ""}`
        }
        showFirstButton
        showLastButton
      />

      {/* Bulk selection */}
      <Menu anchorEl={selectAnchor} open={Boolean(selectAnchor)} onClose={() => setSelectAnchor(null)}>
        <MenuItem onClick={() => select(() => true, "filtered", false)}>
          <ListItemText primary="Select all rows shown" secondary={`${filtered.length} row(s), every page`} />
        </MenuItem>
        <MenuItem onClick={() => select((r) => r.status === "accepted", "all")}>
          <ListItemText primary="Select accepted rows" secondary={`${counts.accepted} row(s) — what Commit will write`} />
        </MenuItem>
        <MenuItem onClick={() => select((r) => r.warnings.length > 0, "all")}>
          <ListItemText primary="Select rows with warnings" secondary={`${counts.warning} row(s)`} />
        </MenuItem>
        <MenuItem onClick={() => select((r) => r.status === "rejected", "all")}>
          <ListItemText primary="Select rejected rows (for review)" secondary="Rejected rows are never committed" />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            onSelectedChange(new Set());
            setSelectAnchor(null);
          }}
        >
          <ListItemText primary="Clear selection" />
        </MenuItem>
      </Menu>

      {/* Column visibility */}
      <Menu anchorEl={columnsAnchor} open={Boolean(columnsAnchor)} onClose={() => setColumnsAnchor(null)} slotProps={{ paper: { sx: { maxHeight: 460 } } }}>
        <Stack direction="row" spacing={1} sx={{ px: 2, py: 0.5 }}>
          <Button size="small" onClick={() => setHiddenOverride([])}>
            Show all
          </Button>
          <Button size="small" onClick={() => setHiddenOverride(null)}>
            Default
          </Button>
          <Button size="small" onClick={() => setWidths({})}>
            Reset widths
          </Button>
        </Stack>
        <Box sx={{ px: 2 }}>
          <FormControlLabel
            control={<Switch size="small" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />}
            label={<Typography variant="body2">Wrap long text (messages)</Typography>}
          />
        </Box>
        <Divider />
        {(["review", "technical"] as const).map((group) => (
          <Box key={group}>
            <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: "block" }}>
              {group === "review" ? "Review fields" : "Technical fields"}
            </Typography>
            {columns
              .filter((column) => (group === "technical") === Boolean(column.technical))
              .map((column) => (
                <MenuItem
                  key={column.key}
                  dense
                  onClick={() => {
                    const next = new Set(hidden);
                    if (next.has(column.key)) next.delete(column.key);
                    else next.add(column.key);
                    setHiddenOverride([...next]);
                  }}
                >
                  <ListItemIcon>
                    <Checkbox size="small" edge="start" checked={!hidden.has(column.key)} tabIndex={-1} disableRipple />
                  </ListItemIcon>
                  <ListItemText primary={column.label} secondary={column.frozen ? "Frozen" : undefined} />
                </MenuItem>
              ))}
          </Box>
        ))}
      </Menu>

      {/* Column filter */}
      <Popover
        open={Boolean(filterAnchor && filterColumn)}
        anchorEl={filterAnchor?.el}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {filterColumn && (
          <ColumnFilterEditor
            column={filterColumn}
            rows={reviewRows}
            filter={filters[filterColumn.key] ?? {}}
            onChange={(next) => updateFilter(filterColumn.key, next)}
          />
        )}
      </Popover>
    </Stack>
  );
}

function QuickChip(props: { label: string; active: boolean; color?: "success" | "error" | "warning"; onClick: () => void }) {
  return (
    <Chip
      size="small"
      clickable
      color={props.color ?? "default"}
      variant={props.active ? "filled" : "outlined"}
      label={props.label}
      onClick={props.onClick}
      sx={{ fontWeight: props.active ? 700 : 500 }}
    />
  );
}

function ColumnFilterEditor(props: {
  column: ReviewColumn;
  rows: ReviewRow[];
  filter: ColumnFilter;
  onChange: (next: ColumnFilter | null) => void;
}) {
  const { column, rows, filter } = props;
  const options = useMemo(() => {
    if (column.key === "status") {
      const has = (v: string) => rows.filter((r) => statusMatches(r.result, v)).length;
      return [STATUS_ACCEPTED, STATUS_REJECTED, STATUS_WARNING].map((value) => ({ value, count: has(value) }));
    }
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = column.value(row) || "(blank)";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
  }, [column, rows]);
  const showValues = column.filter === "select" || options.length <= 12;
  const chosen = new Set(filter.values ?? []);

  return (
    <Stack spacing={1} sx={{ p: 1.5, width: 300 }}>
      <Typography variant="subtitle2">Filter: {column.label}</Typography>
      {column.filter === "text" && (
        <TextField
          size="small"
          autoFocus
          placeholder="Contains…"
          value={filter.text ?? ""}
          onChange={(event) => props.onChange({ ...filter, text: event.target.value })}
        />
      )}
      {showValues && (
        <Box sx={{ maxHeight: 260, overflow: "auto" }}>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              dense
              onClick={() => {
                const next = new Set(chosen);
                if (next.has(option.value)) next.delete(option.value);
                else next.add(option.value);
                props.onChange({ ...filter, values: [...next] });
              }}
            >
              <Checkbox size="small" edge="start" checked={chosen.has(option.value)} tabIndex={-1} disableRipple />
              <ListItemText
                primary={option.value}
                primaryTypographyProps={{ noWrap: true, title: option.value, fontSize: 13 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {option.count}
              </Typography>
            </MenuItem>
          ))}
        </Box>
      )}
      <Stack direction="row" justifyContent="flex-end">
        <Button size="small" onClick={() => props.onChange(null)} disabled={!filter.text && !(filter.values && filter.values.length)}>
          Clear
        </Button>
      </Stack>
    </Stack>
  );
}
