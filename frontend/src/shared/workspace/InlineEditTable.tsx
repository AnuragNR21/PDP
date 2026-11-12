import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import {
  Button,
  CircularProgress,
  InputAdornment,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Children, isValidElement, useMemo, useState, type ReactNode } from 'react';
import { DeleteAction, DuplicateAction, EditAction } from './WorkspaceIcons';

export type InlineEditor = {
  field: string;
  type?: 'text' | 'select';
  options?: Array<{ key: string; label: string }>;
  /** A field that cannot change for this row (a root node type's name, say). */
  disabled?: boolean;
  placeholder?: string;
};

export type InlineColumn<T> = {
  key: string;
  label: string;
  width?: number | string;
  render: (row: T) => ReactNode;
  editor?: InlineEditor | ((row: T) => InlineEditor | undefined);
  /**
   * The text (or number) the column is searched, sorted and filtered by. Left
   * out, it is read from what `render` draws — the text of a Typography, the
   * label of a Chip — which is right for nearly every column.
   */
  value?: (row: T) => string | number;
  /** Offer a filter on this column: one choice per distinct value (Status, Kind…). */
  filter?: boolean;
  /** Leave the column out of sorting (a badge, an icon). */
  sortable?: boolean;
};

/** The plain text of what a cell draws, for search, sort and filter. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; label?: ReactNode };
    return [textOf(props.label), ...Children.toArray(props.children).map(textOf)].filter(Boolean).join(' ');
  }
  return '';
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

/**
 * A list a person edits where it stands: ✎ turns the row into fields, ✓ saves
 * and ✕ (or Escape) leaves it as it was. ⧉ duplicates the row and 🗑 deletes
 * it. One row is edited at a time, so a half-finished edit is never lost to
 * a second one.
 */
export function InlineEditTable<T>(props: {
  rows: T[];
  columns: InlineColumn<T>[];
  getId: (row: T) => string;
  getLabel: (row: T) => string;
  draftOf: (row: T) => Record<string, string>;
  onSave?: (row: T, draft: Record<string, string>) => Promise<boolean | void>;
  /** Rows that should open in a dialog instead of inline. */
  onEdit?: (row: T) => void;
  onDuplicate?: (row: T) => void;
  onDelete?: (row: T) => void;
  canDelete?: (row: T) => boolean;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  /** Right-click on a row (not while it is being edited). */
  onRowContextMenu?: (row: T, event: React.MouseEvent) => void;
  emptyText: string;
  dense?: boolean;
  /** What the rows are, for the search box: "Search element types…". */
  searchPlaceholder?: string;
  /** Hide Search / Sort / Filter (a list of two or three fixed rows). */
  plain?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);

  const valueOf = (column: InlineColumn<T>, row: T): string | number => (column.value ? column.value(row) : textOf(column.render(row)));
  const filterColumns = props.columns.filter((column) => column.filter);
  const filterOptions = useMemo(() => {
    const options: Record<string, string[]> = {};
    for (const column of filterColumns) {
      options[column.key] = Array.from(new Set(props.rows.map((row) => String(valueOf(column, row))).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    return options;
  }, [props.rows, props.columns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search, then filter, then sort — the original order unless a header was clicked.
  const shownRows = useMemo(() => {
    if (props.plain) return props.rows;
    const needle = search.trim().toLowerCase();
    let rows = props.rows.filter((row) => {
      if (needle && !props.columns.some((column) => String(valueOf(column, row)).toLowerCase().includes(needle))) return false;
      return filterColumns.every((column) => !filters[column.key] || String(valueOf(column, row)) === filters[column.key]);
    });
    if (sort) {
      const column = props.columns.find((item) => item.key === sort.key);
      if (column) {
        const factor = sort.direction === 'asc' ? 1 : -1;
        rows = [...rows].sort((a, b) => {
          const left = valueOf(column, a);
          const right = valueOf(column, b);
          if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
          return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * factor;
        });
      }
    }
    return rows;
  }, [props.rows, props.columns, props.plain, search, filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const narrowed = search.trim().length > 0 || Object.values(filters).some(Boolean);
  const clear = () => {
    setSearch('');
    setFilters({});
  };
  const toggleSort = (key: string) =>
    setSort((current) => (current?.key !== key ? { key, direction: 'asc' } : current.direction === 'asc' ? { key, direction: 'desc' } : null));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = (row: T) => {
    if (props.onEdit) {
      props.onEdit(row);
      return;
    }
    setEditingId(props.getId(row));
    setDraft(props.draftOf(row));
  };

  const save = async (row: T) => {
    if (!props.onSave) return;
    setSaving(true);
    try {
      const result = await props.onSave(row, draft);
      if (result !== false) setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const hasActions = Boolean(props.onSave || props.onEdit || props.onDuplicate || props.onDelete);

  return (
    <>
      {!props.plain && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1, flexWrap: 'wrap' }} useFlexGap>
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={props.searchPlaceholder ?? 'Search…'}
            sx={{ width: 240 }}
            inputProps={{ 'aria-label': props.searchPlaceholder ?? 'Search' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          {filterColumns.map((column) => (
            <TextField
              key={column.key}
              select
              size="small"
              label={column.label}
              value={filters[column.key] ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))}
              sx={{ minWidth: 150 }}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">All</MenuItem>
              {(filterOptions[column.key] ?? []).map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          ))}
          {narrowed && (
            <Button size="small" onClick={clear} sx={{ textTransform: 'none' }}>
              Clear
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {narrowed ? `${shownRows.length} of ${props.rows.length}` : `${props.rows.length} ${props.rows.length === 1 ? 'item' : 'items'}`}
          </Typography>
        </Stack>
      )}
    <Table size="small" stickyHeader sx={{ '& td, & th': { py: props.dense ? 0.5 : 0.75 } }}>
      <TableHead>
        <TableRow>
          {props.columns.map((column) => (
            <TableCell
              key={column.key}
              sx={{ fontWeight: 700, width: column.width, bgcolor: 'background.paper' }}
              sortDirection={sort?.key === column.key ? sort.direction : false}
            >
              {props.plain || column.sortable === false ? (
                column.label
              ) : (
                <TableSortLabel active={sort?.key === column.key} direction={sort?.key === column.key ? sort.direction : 'asc'} onClick={() => toggleSort(column.key)}>
                  {column.label}
                </TableSortLabel>
              )}
            </TableCell>
          ))}
          {hasActions && <TableCell sx={{ width: 120, bgcolor: 'background.paper' }} align="right" />}
        </TableRow>
      </TableHead>
      <TableBody>
        {shownRows.length === 0 && (
          <TableRow>
            <TableCell colSpan={props.columns.length + 1}>
              <Typography variant="body2" color="text.secondary">
                {props.rows.length > 0 && narrowed ? (
                  <>
                    Nothing matches the search or filters.{' '}
                    <Button size="small" onClick={clear} sx={{ textTransform: 'none', p: 0, minWidth: 0 }}>
                      Clear
                    </Button>
                  </>
                ) : (
                  props.emptyText
                )}
              </Typography>
            </TableCell>
          </TableRow>
        )}
        {shownRows.map((row) => {
          const id = props.getId(row);
          const editing = editingId === id;
          const label = props.getLabel(row);
          return (
            <TableRow
              key={id}
              hover
              selected={props.selectedId === id}
              onClick={editing ? undefined : () => props.onRowClick?.(row)}
              onContextMenu={!editing && props.onRowContextMenu ? (event) => props.onRowContextMenu!(row, event) : undefined}
              data-reveal-id={id}
              sx={{ cursor: props.onRowClick && !editing ? 'pointer' : 'default' }}
              onKeyDown={(event) => {
                if (!editing) return;
                if (event.key === 'Escape') setEditingId(null);
                if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') void save(row);
              }}
            >
              {props.columns.map((column) => {
                const editor = typeof column.editor === 'function' ? column.editor(row) : column.editor;
                return (
                  <TableCell key={column.key} onClick={editing ? (event) => event.stopPropagation() : undefined}>
                    {editing && editor ? (
                      <TextField
                        size="small"
                        fullWidth
                        select={editor.type === 'select'}
                        disabled={editor.disabled || saving}
                        value={draft[editor.field] ?? ''}
                        placeholder={editor.placeholder}
                        onChange={(event) => setDraft((current) => ({ ...current, [editor.field]: event.target.value }))}
                        inputProps={{ 'aria-label': `${column.label} of ${label}` }}
                        autoFocus={column === props.columns.find((c) => c.editor)}
                      >
                        {(editor.options ?? []).map((option) => (
                          <MenuItem key={option.key} value={option.key}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      column.render(row)
                    )}
                  </TableCell>
                );
              })}
              {hasActions && (
                <TableCell align="right" onClick={(event) => event.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
                  {editing ? (
                    <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                      <Tooltip title="Save">
                        <span>
                          <IconButton size="small" color="primary" disabled={saving} onClick={() => void save(row)} aria-label={`Save ${label}`}>
                            {saving ? <CircularProgress size={16} /> : <CheckOutlined fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Cancel">
                        <IconButton size="small" disabled={saving} onClick={() => setEditingId(null)} aria-label={`Cancel editing ${label}`}>
                          <CloseOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                      {(props.onSave || props.onEdit) && <EditAction label={label} onClick={() => startEdit(row)} disabled={editingId !== null} />}
                      {props.onDuplicate && <DuplicateAction label={label} onClick={() => props.onDuplicate!(row)} disabled={editingId !== null} />}
                      {props.onDelete && (
                        <DeleteAction
                          label={label}
                          onClick={() => props.onDelete!(row)}
                          disabled={editingId !== null || (props.canDelete ? !props.canDelete(row) : false)}
                        />
                      )}
                    </Stack>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </>
  );
}
