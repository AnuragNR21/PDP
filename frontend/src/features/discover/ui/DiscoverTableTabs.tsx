import { useEffect, useRef, useState } from "react";
import { Box, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import type { SessionSourceFile } from "@/features/discover/api/discoverApi";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";

/**
 * The tables of a session, as a row of tabs above the step.
 *
 * A session is one workbook as often as it is one file, and a workbook is
 * several tables. Every step works on one table at a time, so switching has to
 * be the most obvious thing on the screen — which is what a browser tab bar
 * is: the tabs sit on top, the active one is joined to the panel below it, and
 * you close one where you see it. The panel underneath is the table you have
 * open, exactly as a page is the tab you have open.
 *
 * The bar is deliberately thin. It names each table, says how big it is and
 * how far it has got, and nothing else; the detail belongs to the step below.
 */

/** What has happened to a table so far, in one word and one colour. */
function stageOf(file: SessionSourceFile): { label: string; color: string } {
  if (file.findings > 0) {
    return file.failing_checks > 0
      ? { label: "checked · findings", color: "warning.main" }
      : { label: "checked · clean", color: "success.main" };
  }
  if (file.rules_attached > 0) return { label: "rules chosen", color: "info.main" };
  if (file.mapped_columns > 0) return { label: "mapped", color: "primary.main" };
  return { label: "imported", color: "text.disabled" };
}

/**
 * What to write on the tab.
 *
 * A split upload names its sources "<file> — <sheet>", and a tab is too narrow
 * to hold both: truncating from the right ate the sheet name and left a row of
 * tabs all reading "multi_table_sample.csv — …", which is the one part that
 * does not tell them apart. So the sheet is the label. The file it came from
 * is added back only when two sheets share a name — "Table 1" from two stacked
 * CSVs — because then the file is what tells them apart.
 */
function labelFor(file: SessionSourceFile, files: SessionSourceFile[]): string {
  const [source, sheet] = splitName(file.original_filename);
  if (!sheet) return source;
  const sharesName = files.some(
    (other) =>
      other.source_file_id !== file.source_file_id &&
      splitName(other.original_filename)[1] === sheet,
  );
  return sharesName ? `${source.replace(/\.[^.]+$/, "")} · ${sheet}` : sheet;
}

function splitName(name: string): [string, string] {
  const at = name.indexOf(" — ");
  return at === -1 ? [name, ""] : [name.slice(0, at), name.slice(at + 3)];
}

function describe(file: SessionSourceFile): string {
  const shape = file.row_count
    ? `${file.row_count.toLocaleString()} rows × ${file.column_count} columns`
    : "not profiled yet";
  const progress = [
    file.mapped_columns > 0 ? `${file.mapped_columns} mapped` : "not mapped",
    file.rules_attached > 0 ? `${file.rules_attached} rules` : "no rules",
    file.findings > 0
      ? `${file.failing_checks} of ${file.findings} checks failing`
      : "not checked",
  ].join(" · ");
  return `${file.original_filename} · ${shape} · ${progress}`;
}

export function DiscoverTableTabs({ vm }: { vm: ReturnType<typeof useDiscoverWorkspace> }) {
  const files = vm.sourceFilesQuery.data ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const switching = vm.activateSourceFileMutation.isPending;

  // Arrows earn their place only when the tabs do not fit.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [files.length]);

  // Changing table from a tab that is scrolled out of sight leaves the person
  // looking at the wrong end of the strip, so the active tab is brought back.
  useEffect(() => {
    scroller.current?.querySelector('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [files.map((f) => `${f.source_file_id}:${f.is_active}`).join()]);

  if (files.length === 0) return null;

  const nudge = (by: number) => scroller.current?.scrollBy({ left: by, behavior: "smooth" });

  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 3,
        // The bar and the panel below it are one surface, joined at the active
        // tab, so the tabs sit in the page rather than floating over it.
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.default",
        pt: 0.5,
      }}
    >
      <Stack direction="row" alignItems="stretch" sx={{ minHeight: 46 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ pl: 1.5, flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {files.length === 1 ? "Table" : `${files.length} tables`}
          </Typography>
          {switching && <CircularProgress size={12} />}
        </Stack>

        {overflowing && (
          <IconButton size="small" onClick={() => nudge(-240)} sx={{ alignSelf: "center", ml: 0.5 }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        )}

        <Box
          ref={scroller}
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: 0.5,
            px: 1,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            // A scrollbar under tabs reads as a second row of chrome; the
            // arrows and the trackpad both still work without it.
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {files.map((file) => {
            const stage = stageOf(file);
            return (
              <Tooltip key={file.source_file_id} title={describe(file)} placement="top">
                <Box
                  data-active={file.is_active}
                  onClick={
                    file.is_active || switching
                      ? undefined
                      : () => vm.activateSourceFileMutation.mutate(file.source_file_id)
                  }
                  sx={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    flexShrink: 0,
                    maxWidth: 240,
                    px: 1.25,
                    py: 0.85,
                    mb: "-1px",
                    borderRadius: "8px 8px 0 0",
                    border: 1,
                    borderColor: file.is_active ? "divider" : "transparent",
                    borderBottomColor: file.is_active ? "background.paper" : "transparent",
                    borderTopWidth: 2,
                    borderTopColor: file.is_active ? "primary.main" : "transparent",
                    bgcolor: file.is_active ? "background.paper" : "action.hover",
                    cursor: file.is_active ? "default" : "pointer",
                    "&:hover": { bgcolor: file.is_active ? "background.paper" : "action.selected" },
                    "&:hover .tab-remove": { opacity: 1 },
                  }}
                >
                  <Box
                    sx={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      bgcolor: stage.color,
                    }}
                  />
                  <Typography
                    variant="caption"
                    fontWeight={file.is_active ? 700 : 500}
                    sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {labelFor(file, files)}
                  </Typography>
                  {file.row_count !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem", flexShrink: 0 }}>
                      {file.row_count.toLocaleString()}
                    </Typography>
                  )}
                  {/* Removing a table drops its rows, mappings and results, so
                      the control stays out of the way until pointed at. */}
                  <IconButton
                    className="tab-remove"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      vm.removeSourceFileMutation.mutate(file.source_file_id);
                    }}
                    sx={{ p: 0.1, opacity: 0, transition: "0.15s", flexShrink: 0 }}
                  >
                    <CloseIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        {overflowing && (
          <IconButton size="small" onClick={() => nudge(240)} sx={{ alignSelf: "center", mr: 0.5 }}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        )}

        {files.length > 1 && (
          <Stack direction="row" alignItems="center" sx={{ pr: 1.5, flexShrink: 0 }}>
            <Chip
              size="small"
              variant="outlined"
              label={`${files.filter((f) => f.mapped_columns > 0).length}/${files.length} mapped`}
              sx={{ height: 20, fontSize: "0.65rem" }}
            />
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
