import ManageSearchOutlined from "@mui/icons-material/ManageSearchOutlined";
import SchemaOutlined from "@mui/icons-material/SchemaOutlined";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { SavedDiagramSummary } from "@/features/cross-model";
import { modelDefinitionsApi } from "../../../api/modelDefinitionsApi";
import { ContextMenu } from "./ContextMenu";

/**
 * Find in Model / Find in Diagram(s) — navigation between a type in its model
 * and the Relationship Diagrams it is drawn on. Both only move the view:
 * nothing governed is changed.
 *
 * The request travels in the address as two one-off parameters, read and then
 * removed by the page that receives it: `diagram` (which saved diagram to
 * open) and `focus` (the node type or element type to select and bring into view).
 */
export const DIAGRAM_PARAM = "diagram";
export const FOCUS_PARAM = "focus";
const MWS_PATH = "/model/tree-models";

/** The type in its model: open the model and select the type. */
export function findInModelHref(kind: "hierarchy" | "support", modelId: string, typeId: string) {
  const params = new URLSearchParams({ kind, model: modelId, [FOCUS_PARAM]: typeId });
  return `${MWS_PATH}?${params.toString()}`;
}

/** The type on a diagram: open the Relationship Diagram on it, centred on the type. */
export function findInDiagramHref(diagramId: string, typeId: string) {
  const params = new URLSearchParams({ tab: "relationship", view: "diagram", [DIAGRAM_PARAM]: diagramId, [FOCUS_PARAM]: typeId });
  return `${MWS_PATH}?${params.toString()}`;
}

/** Same cache the Diagram picker reads, so a search also refreshes the picker's list. */
const LIST_KEY = ["cross-model-relationship-type-diagrams"] as const;

/** Every saved Relationship Diagram that has this type on it, most recently changed first. */
export async function diagramsContaining(queryClient: QueryClient, typeId: string): Promise<SavedDiagramSummary[]> {
  const summaries = await queryClient.fetchQuery({ queryKey: LIST_KEY, queryFn: modelDefinitionsApi.listCrossModelRelationshipTypeDiagrams, staleTime: 0 });
  const details = await Promise.all(
    summaries.map((summary) =>
      queryClient.fetchQuery({
        queryKey: ["cross-model-relationship-type-diagram", summary.id, summary.updatedAt],
        queryFn: () => modelDefinitionsApi.getCrossModelRelationshipTypeDiagram(summary.id),
        staleTime: 60_000,
      }),
    ),
  );
  return summaries
    .filter((_summary, index) => details[index].nodes.some((node) => node.itemId === typeId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatWhen(value: string) {
  const date = new Date(value.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type Target = { id: string; name: string };
type Search =
  | { state: "searching"; target: Target }
  | { state: "none"; target: Target }
  | { state: "many"; target: Target; diagrams: SavedDiagramSummary[] }
  | { state: "error"; target: Target };

/**
 * The right-click menu for a type in the Model tab — Find in Diagram(s) — and
 * what follows it: one diagram opens straight away, several are offered to
 * choose from, none is said plainly.
 *
 * `guard` runs the navigation, so unsaved changes in the details panel are
 * asked about first.
 */
export function useFindInDiagrams(options?: { guard?: (action: () => void) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ top: number; left: number; target: Target } | null>(null);
  const [search, setSearch] = useState<Search | null>(null);

  const go = (diagramId: string, typeId: string) => {
    const run = () => navigate(findInDiagramHref(diagramId, typeId));
    if (options?.guard) options.guard(run);
    else run();
  };

  const find = async (target: Target) => {
    setSearch({ state: "searching", target });
    try {
      const found = await diagramsContaining(queryClient, target.id);
      if (found.length === 1) {
        setSearch(null);
        go(found[0].id, target.id);
      } else if (found.length === 0) {
        setSearch({ state: "none", target });
      } else {
        setSearch({ state: "many", target, diagrams: found });
      }
    } catch {
      setSearch({ state: "error", target });
    }
  };

  const openMenu = (target: Target, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ top: event.clientY, left: event.clientX, target });
  };

  const element: ReactNode = (
    <>
      <ContextMenu
        position={menu ? { top: menu.top, left: menu.left } : null}
        title={menu?.target.name}
        items={
          menu
            ? [{ kind: "item", key: "find-diagrams", label: "Find in Diagram(s)", icon: <ManageSearchOutlined />, onClick: () => void find(menu.target) }]
            : []
        }
        onClose={() => setMenu(null)}
      />
      <Dialog open={Boolean(search)} onClose={() => setSearch(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Find in Diagram(s)</DialogTitle>
        <DialogContent>
          {search?.state === "searching" && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Looking for “{search.target.name}” in the saved Relationship Diagrams…</Typography>
            </Stack>
          )}
          {search?.state === "none" && (
            <Alert severity="info" variant="outlined">
              “{search.target.name}” is not on any saved Relationship Diagram.
            </Alert>
          )}
          {search?.state === "error" && (
            <Alert severity="error" variant="outlined">
              The saved diagrams could not be read. Try again in a moment.
            </Alert>
          )}
          {search?.state === "many" && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                “{search.target.name}” is on {search.diagrams.length} diagrams. Choose one to open:
              </Typography>
              <List dense disablePadding sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                {search.diagrams.map((diagram) => (
                  <ListItemButton
                    key={diagram.id}
                    onClick={() => {
                      setSearch(null);
                      go(diagram.id, search.target.id);
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      <SchemaOutlined fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={diagram.name}
                      secondary={`${diagram.nodeCount} type${diagram.nodeCount === 1 ? "" : "s"} · updated ${formatWhen(diagram.updatedAt)}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearch(null)}>{search?.state === "many" ? "Cancel" : "Close"}</Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return { openMenu, element };
}
