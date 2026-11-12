import { useState, type MouseEvent } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { Box, Divider, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from "@mui/material";
import BorderColorOutlinedIcon from "@mui/icons-material/BorderColorOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FormatColorTextIcon from "@mui/icons-material/FormatColorText";
import FormatSizeIcon from "@mui/icons-material/FormatSize";
import FlipToFrontIcon from "@mui/icons-material/FlipToFront";
import FlipToBackIcon from "@mui/icons-material/FlipToBack";
import {
  DIAGRAM_SHAPE_FONT_SIZES,
  DIAGRAM_SHAPE_PALETTE,
  type DiagramShape,
  type DiagramShapeKind,
} from "../domain/diagramShape";

/**
 * Above every node layer. ReactFlow derives a toolbar's z-index from its node
 * (`node.internals.z + 1`), which since selection stopped elevating nodes would
 * leave it under the cards — visible, but with its buttons unclickable.
 */
const TOOLBAR_Z_INDEX = 2000;

/** The style fields this toolbar can change. */
export type ShapeStylePatch = Partial<Pick<DiagramShape, "strokeColor" | "textColor" | "fontSize">>;

type ToolButtonProps = {
  title: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  children: React.ReactNode;
  /** Colour swatch shown under the icon, for the colour tools. */
  swatch?: string;
};

function ToolButton({ title, onClick, children, swatch }: ToolButtonProps) {
  return (
    <Tooltip title={title} arrow>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        sx={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: "2px", width: 30, height: 28, p: 0,
          border: "none", background: "transparent", borderRadius: 1,
          color: "text.secondary", cursor: "pointer",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
        }}
      >
        {children}
        {swatch && <Box sx={{ width: 16, height: 3, borderRadius: "2px", bgcolor: swatch }} />}
      </Box>
    </Tooltip>
  );
}

/**
 * The floating actions for a selected annotation, above the shape itself.
 *
 * A frame or note offers its outline colour; a text label offers size and
 * colour. Both offer delete. Nothing here touches business data — these are
 * looks, and they travel with the diagram they were drawn on.
 */
export function ShapeFormatToolbar({
  kind,
  strokeColor,
  textColor,
  fontSize,
  defaultStrokeColor,
  defaultTextColor,
  defaultFontSize,
  visible,
  onChange,
  onBringToFront,
  onSendToBack,
  onRemove,
}: {
  kind: DiagramShapeKind;
  strokeColor?: string | null;
  textColor?: string | null;
  fontSize?: number | null;
  defaultStrokeColor: string;
  defaultTextColor: string;
  defaultFontSize: number;
  visible: boolean;
  onChange: (patch: ShapeStylePatch) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState<{ kind: "stroke" | "text" | "size"; anchor: HTMLElement } | null>(null);
  const isText = kind === "TEXT";
  const close = () => setMenu(null);

  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={12} style={{ zIndex: TOOLBAR_Z_INDEX }}>
      <Paper
        elevation={4}
        // The toolbar lives inside a node whose wrapper switches pointer events
        // off so a frame's middle stays click-through.
        sx={{ display: "flex", alignItems: "center", px: 0.5, py: 0.25, borderRadius: 1.5, pointerEvents: "auto" }}
        onClick={(event) => event.stopPropagation()}
      >
        <Stack direction="row" spacing={0.25} alignItems="center">
          {isText ? (
            <>
              <ToolButton title="Text size" onClick={(event) => setMenu({ kind: "size", anchor: event.currentTarget })}>
                <FormatSizeIcon sx={{ fontSize: 17 }} />
              </ToolButton>
              <ToolButton
                title="Text colour"
                swatch={textColor ?? defaultTextColor}
                onClick={(event) => setMenu({ kind: "text", anchor: event.currentTarget })}
              >
                <FormatColorTextIcon sx={{ fontSize: 17 }} />
              </ToolButton>
            </>
          ) : (
            <ToolButton
              title="Border colour"
              swatch={strokeColor ?? defaultStrokeColor}
              onClick={(event) => setMenu({ kind: "stroke", anchor: event.currentTarget })}
            >
              <BorderColorOutlinedIcon sx={{ fontSize: 17 }} />
            </ToolButton>
          )}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />

          <ToolButton title="Bring to front" onClick={onBringToFront}>
            <FlipToFrontIcon sx={{ fontSize: 17 }} />
          </ToolButton>
          <ToolButton title="Send to back" onClick={onSendToBack}>
            <FlipToBackIcon sx={{ fontSize: 17 }} />
          </ToolButton>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />

          <ToolButton title="Delete" onClick={onRemove}>
            <DeleteOutlineIcon sx={{ fontSize: 17 }} />
          </ToolButton>
        </Stack>
      </Paper>

      <Menu
        open={menu?.kind === "size"}
        anchorEl={menu?.anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {DIAGRAM_SHAPE_FONT_SIZES.map((size) => (
          <MenuItem
            key={size}
            selected={(fontSize ?? defaultFontSize) === size}
            onClick={() => { onChange({ fontSize: size }); close(); }}
            sx={{ minWidth: 96 }}
          >
            <Typography sx={{ fontSize: size > 20 ? 20 : size }}>{size}px</Typography>
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={menu?.kind === "stroke" || menu?.kind === "text"}
        anchorEl={menu?.anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        slotProps={{ paper: { sx: { p: 0.75 } } }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 24px)", gap: 0.75 }}>
          {DIAGRAM_SHAPE_PALETTE.map((color) => {
            const current = menu?.kind === "text" ? textColor ?? defaultTextColor : strokeColor ?? defaultStrokeColor;
            return (
              <Box
                key={color}
                component="button"
                type="button"
                onClick={() => {
                  onChange(menu?.kind === "text" ? { textColor: color } : { strokeColor: color });
                  close();
                }}
                sx={{
                  width: 24, height: 24, borderRadius: "50%", cursor: "pointer",
                  bgcolor: color, p: 0,
                  border: "2px solid",
                  borderColor: current === color ? "text.primary" : "transparent",
                  outline: "1px solid rgba(0,0,0,0.12)",
                  outlineOffset: "-1px",
                }}
              />
            );
          })}
        </Box>
      </Menu>
    </NodeToolbar>
  );
}
