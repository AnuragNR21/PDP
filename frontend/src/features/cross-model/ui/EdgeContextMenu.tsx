import { useEffect, useState } from "react";
import {
  Box,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBackIosNew";
import CheckIcon from "@mui/icons-material/Check";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import { EDGE_STYLES, EDGE_STYLE_LABELS, type EdgeStyle } from "../domain/edgeStyle";

/** Miniature preview of each line shape, drawn next to its label. */
const SHAPE_PATHS: Record<EdgeStyle, string> = {
  curved: "M2 14 C 10 14, 12 4, 22 4",
  straight: "M2 14 L 22 4",
  elbow: "M2 14 L 12 14 L 12 4 L 22 4",
};

function ShapePreview({ style }: { style: EdgeStyle }) {
  return (
    <svg width={24} height={18} viewBox="0 0 24 18" aria-hidden>
      <path d={SHAPE_PATHS[style]} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/** A relationship carried by the connection that was right-clicked. */
export type EdgeMenuRelationship = {
  id: string;
  name: string;
  /** Catalogue colour, shown as a dot; falls back to the divider colour. */
  color?: string;
};

export type EdgeContextMenuProps = {
  /** Viewport coordinates of the right-click, or null when closed. */
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  /** Style currently applied to the connection. */
  currentStyle: EdgeStyle;
  onSelectStyle: (style: EdgeStyle) => void;
  /**
   * Relationships this connection stands for. The "Update relationship" entry is
   * hidden when this is empty or no handler is supplied — the instance-level
   * diagram has no edit dialog of its own.
   */
  relationships?: EdgeMenuRelationship[];
  onUpdateRelationship?: (relationshipId: string) => void;
};

type MenuView = "root" | "relationships" | "style";

/**
 * Right-click menu for a connection. Navigates in place rather than using nested
 * submenus, so new top-level actions can be added without restructuring.
 */
export function EdgeContextMenu({
  anchorPosition,
  onClose,
  currentStyle,
  onSelectStyle,
  relationships,
  onUpdateRelationship,
}: EdgeContextMenuProps) {
  const open = anchorPosition !== null;
  const [view, setView] = useState<MenuView>("root");

  // Always reopen on the root list, never wherever the last visit left off.
  useEffect(() => {
    if (open) setView("root");
  }, [open]);

  const canUpdate = Boolean(onUpdateRelationship) && (relationships?.length ?? 0) > 0;

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      slotProps={{ paper: { sx: { minWidth: 232 } } }}
    >
      {view === "root" && (
        <ListSubheader sx={{ lineHeight: "34px", fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>
          CrossModel Relationship
        </ListSubheader>
      )}
      {view === "root" && <Divider sx={{ mt: 0, mb: 0.5 }} />}

      {view === "root" && canUpdate && (
        <MenuItem onClick={() => setView("relationships")}>
          <ListItemIcon sx={{ minWidth: 32 }}><EditOutlinedIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }} primary="Update relationship" />
          <ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled", ml: 1 }} />
        </MenuItem>
      )}

      {view === "root" && (
        <MenuItem onClick={() => setView("style")}>
          <ListItemIcon sx={{ minWidth: 32 }}><TimelineOutlinedIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }} primary="Edge style" />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {EDGE_STYLE_LABELS[currentStyle]}
          </Typography>
          <ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled", ml: 0.5 }} />
        </MenuItem>
      )}

      {view === "relationships" && (
        <MenuItem onClick={() => setView("root")} sx={{ color: "text.secondary" }}>
          <ListItemIcon sx={{ minWidth: 32 }}><ArrowBackIcon sx={{ fontSize: 13 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "caption", fontWeight: 700 }} primary="Update relationship" />
        </MenuItem>
      )}
      {view === "relationships" && <Divider sx={{ mb: 0.5 }} />}
      {view === "relationships" && relationships?.map((rel) => (
        <MenuItem
          key={rel.id}
          onClick={() => { onUpdateRelationship?.(rel.id); onClose(); }}
          sx={{ gap: 1 }}
        >
          <Box sx={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            bgcolor: rel.color ?? "divider",
          }} />
          <Typography variant="body2" noWrap>{rel.name}</Typography>
        </MenuItem>
      ))}

      {view === "style" && (
        <MenuItem onClick={() => setView("root")} sx={{ color: "text.secondary" }}>
          <ListItemIcon sx={{ minWidth: 32 }}><ArrowBackIcon sx={{ fontSize: 13 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "caption", fontWeight: 700 }} primary="Edge style" />
        </MenuItem>
      )}
      {view === "style" && <Divider sx={{ mb: 0.5 }} />}
      {view === "style" && EDGE_STYLES.map((style) => (
        <MenuItem
          key={style}
          selected={style === currentStyle}
          onClick={() => { onSelectStyle(style); onClose(); }}
          sx={{ gap: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0, color: "text.secondary" }}>
            <ShapePreview style={style} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }} primary={EDGE_STYLE_LABELS[style]} />
          {style === currentStyle && <CheckIcon color="primary" sx={{ fontSize: 16 }} />}
        </MenuItem>
      ))}
    </Menu>
  );
}
