import CategoryOutlined from "@mui/icons-material/CategoryOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DataObjectOutlined from "@mui/icons-material/DataObjectOutlined";
import GavelOutlined from "@mui/icons-material/GavelOutlined";
import LinkOutlined from "@mui/icons-material/LinkOutlined";
import SearchIcon from "@mui/icons-material/Search";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import VerifiedUserOutlined from "@mui/icons-material/VerifiedUserOutlined";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Popper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import { searchApi } from "../api/searchApi";
import {
  resultContext,
  resultHref,
  SEARCH_GROUPS,
  statusLabel,
  type SearchGroupId,
  type SearchResult,
  type SearchStatus,
} from "../domain/globalSearch";

const DEBOUNCE_MS = 250;
const PER_GROUP = 6;
const ONE_GROUP = 40;

const GROUP_ICON: Record<SearchGroupId, ReactNode> = {
  models: null,
  types: <CategoryOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  instances: <DataObjectOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  properties: <TuneOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  relationships: <LinkOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  rules: <GavelOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  discover: <StorageOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
  quality: <VerifiedUserOutlined sx={{ fontSize: 18, color: "text.secondary" }} />,
};

function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase();
  const at = q ? text.toLocaleLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="mark" sx={{ bgcolor: "warning.light", color: "inherit", px: 0 }}>{text.slice(at, at + q.length)}</Box>
      {text.slice(at + q.length)}
    </>
  );
}

/** The words around the match in a long description, so the reader sees why it was found. */
function excerpt(text: string, query: string, room = 90) {
  const at = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  if (at < 0 || text.length <= room) return text;
  const start = Math.max(0, at - Math.floor(room / 3));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + room)}${start + room < text.length ? "…" : ""}`;
}

function StatusChip({ status }: { status: string | null }) {
  const label = statusLabel(status);
  if (!label) return null;
  const archived = status === "retired";
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      color={status === "active" ? "success" : archived ? "default" : "warning"}
      sx={{ height: 18, fontSize: 10, flexShrink: 0, ...(archived ? { borderStyle: "dashed", color: "text.secondary" } : {}) }}
    />
  );
}

/**
 * Search All — one search across PDP, answering "where is this in PDP?".
 *
 * The server does the searching (names, descriptions and metadata of models,
 * types, instances, properties, relationships, rules, Discover content and
 * quality findings) and ranks name matches ahead of description and property
 * matches. Results are grouped by kind, each says what it is and where it
 * belongs, shows its lifecycle, and opens the object itself.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<SearchGroupId | "all">("all");
  const [status, setStatus] = useState<SearchStatus | "">("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const enabled = debounced.length >= 2;
  const search = useQuery({
    queryKey: ["global-search", debounced, group, status],
    queryFn: ({ signal }) =>
      searchApi.search(
        { q: debounced, types: group === "all" ? undefined : [group], status: status || undefined, limit: group === "all" ? PER_GROUP : ONE_GROUP },
        signal,
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const groups = useMemo(() => (enabled ? search.data?.groups ?? [] : []), [enabled, search.data]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const counts = search.data?.counts;
  useEffect(() => setCursor(0), [debounced, group, status]);

  const close = () => setOpen(false);
  const go = (result: SearchResult) => {
    const href = resultHref(result);
    if (!href) return;
    close();
    setText("");
    setDebounced("");
    inputRef.current?.blur();
    navigate(href);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor((at) => Math.min(flat.length - 1, at + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((at) => Math.max(0, at - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = flat[cursor];
      if (chosen) go(chosen);
    }
  };

  // Keep the keyboard choice on screen.
  useEffect(() => {
    document.querySelector(`[data-search-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let index = -1;
  const showPanel = open && text.trim().length > 0;

  return (
    <ClickAwayListener onClickAway={close}>
      <Box ref={anchorRef} sx={{ width: { xs: 200, md: 380 } }}>
        <TextField
          size="small"
          fullWidth
          inputRef={inputRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search All…"
          inputProps={{ "aria-label": "Search all of PDP", role: "combobox", "aria-expanded": showPanel }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                {search.isFetching && enabled && <CircularProgress size={14} sx={{ mr: 0.5 }} />}
                {text && (
                  <IconButton
                    size="small"
                    aria-label="Clear search"
                    onClick={() => {
                      setText("");
                      setDebounced("");
                      inputRef.current?.focus();
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          }}
        />
        <Popper open={showPanel} anchorEl={anchorRef.current} placement="bottom" sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}>
          <Paper elevation={8} sx={{ mt: 0.75, width: { xs: "calc(100vw - 32px)", sm: 620 }, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
            {/* Narrow by kind and by lifecycle; counts come with every search. */}
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.5, pt: 1.25, pb: 1, flexWrap: "wrap", rowGap: 0.75, borderBottom: 1, borderColor: "divider" }}>
              <Chip
                size="small"
                label={`All${counts ? ` ${search.data?.total ?? 0}` : ""}`}
                color={group === "all" ? "primary" : "default"}
                variant={group === "all" ? "filled" : "outlined"}
                onClick={() => setGroup("all")}
              />
              {SEARCH_GROUPS.map(({ id, label }) => {
                const count = counts?.[id] ?? 0;
                if (enabled && counts && count === 0 && group !== id) return null;
                return (
                  <Chip
                    key={id}
                    size="small"
                    label={counts ? `${label} ${count}` : label}
                    color={group === id ? "primary" : "default"}
                    variant={group === id ? "filled" : "outlined"}
                    onClick={() => setGroup(group === id ? "all" : id)}
                  />
                );
              })}
              <Box sx={{ flex: 1 }} />
              <Select
                size="small"
                value={status}
                displayEmpty
                onChange={(event) => setStatus(event.target.value as SearchStatus | "")}
                inputProps={{ "aria-label": "Filter by status" }}
                MenuProps={{ disablePortal: true }}
                sx={{ fontSize: 12, height: 26, minWidth: 110 }}
              >
                <MenuItem value="" sx={{ fontSize: 13 }}>Any status</MenuItem>
                <MenuItem value="draft" sx={{ fontSize: 13 }}>Draft</MenuItem>
                <MenuItem value="active" sx={{ fontSize: 13 }}>Active</MenuItem>
                <MenuItem value="retired" sx={{ fontSize: 13 }}>Archived</MenuItem>
              </Select>
            </Stack>

            <Box sx={{ overflowY: "auto", flex: 1, minHeight: 0 }} role="listbox" aria-label="Search results">
              {!enabled ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Type at least two characters.</Typography>
              ) : search.isError ? (
                <Typography variant="body2" color="error" sx={{ p: 2 }}>Search failed. Try again.</Typography>
              ) : search.isLoading ? (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">Searching PDP…</Typography>
                </Stack>
              ) : groups.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                  Nothing in PDP matches “{debounced}”{group !== "all" || status ? " with these filters" : ""}.
                </Typography>
              ) : (
                groups.map((g) => (
                  <Box key={g.group} sx={{ "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}>
                    <Stack direction="row" alignItems="center" sx={{ px: 1.5, pt: 1, pb: 0.25 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ flex: 1, lineHeight: 1.6, fontWeight: 700 }}>
                        {g.label} · {g.total}
                      </Typography>
                      {group === "all" && g.total > g.items.length && (
                        <Button size="small" onClick={() => setGroup(g.group)} sx={{ textTransform: "none", py: 0, minHeight: 0, fontSize: 12 }}>
                          Show all {g.total}
                        </Button>
                      )}
                    </Stack>
                    {g.items.map((result) => {
                      index += 1;
                      const at = index;
                      const href = resultHref(result);
                      const why =
                        result.match === "property" && result.snippet
                          ? `Matches: ${result.snippet}`
                          : result.match === "description" && result.description
                            ? excerpt(result.description, debounced)
                            : null;
                      return (
                        <Box
                          key={`${result.type}:${result.id}`}
                          role="option"
                          aria-selected={at === cursor}
                          aria-disabled={!href}
                          data-search-index={at}
                          onMouseEnter={() => setCursor(at)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => go(result)}
                          sx={{
                            display: "flex",
                            gap: 1.25,
                            alignItems: "flex-start",
                            px: 1.5,
                            py: 0.75,
                            cursor: href ? "pointer" : "default",
                            bgcolor: at === cursor ? "action.selected" : "transparent",
                            opacity: href ? 1 : 0.7,
                          }}
                        >
                          <Box sx={{ pt: 0.25, display: "flex", width: 22, justifyContent: "center", flexShrink: 0 }}>
                            {g.group === "models" && result.model_kind ? <ModelKindIcon kind={result.model_kind} size={20} /> : GROUP_ICON[g.group]}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>
                                <Highlighted text={result.name} query={debounced} />
                              </Typography>
                              <StatusChip status={result.status} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {resultContext(result)}
                            </Typography>
                            {why && (
                              <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ fontStyle: "italic" }}>
                                <Highlighted text={why} query={debounced} />
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                ))
              )}
            </Box>
            {enabled && groups.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: "divider" }}>
                ↑ ↓ to move · Enter to open · Esc to close
              </Typography>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
