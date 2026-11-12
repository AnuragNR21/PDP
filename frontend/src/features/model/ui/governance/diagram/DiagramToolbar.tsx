import AlignHorizontalCenter from "@mui/icons-material/AlignHorizontalCenter";
import AlignHorizontalLeft from "@mui/icons-material/AlignHorizontalLeft";
import AlignHorizontalRight from "@mui/icons-material/AlignHorizontalRight";
import AlignVerticalBottom from "@mui/icons-material/AlignVerticalBottom";
import AlignVerticalCenter from "@mui/icons-material/AlignVerticalCenter";
import AlignVerticalTop from "@mui/icons-material/AlignVerticalTop";
import ArrowDownwardOutlined from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpwardOutlined from "@mui/icons-material/ArrowUpwardOutlined";
import AutoFixHighOutlined from "@mui/icons-material/AutoFixHighOutlined";
import CheckBoxOutlineBlankOutlined from "@mui/icons-material/CheckBoxOutlineBlankOutlined";
import CircleOutlined from "@mui/icons-material/CircleOutlined";
import CropFreeOutlined from "@mui/icons-material/CropFreeOutlined";
import FlipToBackOutlined from "@mui/icons-material/FlipToBackOutlined";
import FlipToFrontOutlined from "@mui/icons-material/FlipToFrontOutlined";
import GridGoldenratioOutlined from "@mui/icons-material/GridGoldenratioOutlined";
import GridOnOutlined from "@mui/icons-material/GridOnOutlined";
import GroupWorkOutlined from "@mui/icons-material/GroupWorkOutlined";
import HeightOutlined from "@mui/icons-material/HeightOutlined";
import LayersClearOutlined from "@mui/icons-material/LayersClearOutlined";
import NearMeOutlined from "@mui/icons-material/NearMeOutlined";
import PanToolOutlined from "@mui/icons-material/PanToolOutlined";
import RestorePageOutlined from "@mui/icons-material/RestorePageOutlined";
import RotateLeftOutlined from "@mui/icons-material/RotateLeftOutlined";
import RotateRightOutlined from "@mui/icons-material/RotateRightOutlined";
import StickyNote2Outlined from "@mui/icons-material/StickyNote2Outlined";
import TextFieldsOutlined from "@mui/icons-material/TextFields";
import ZoomInOutlined from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlined from "@mui/icons-material/ZoomOutOutlined";
import { Box, ButtonBase, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DIAGRAM_SHAPE_LABELS, type DiagramShapeKind } from "@/features/cross-model";
import type { AlignMode, ArrangeOp } from "./presentation";

export type InteractionMode = "select" | "pan";

export type DiagramToolbarProps = {
  mode: InteractionMode;
  onMode: (mode: InteractionMode) => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  grid: boolean;
  snap: boolean;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  /** How many objects are selected, and how many of them are annotations. */
  selectedCount: number;
  selectedShapeCount: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onArrange: (op: ArrangeOp) => void;
  onRotate: (degrees: number) => void;
  canGroup: boolean;
  canUngroup: boolean;
  canRegroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onRegroup: () => void;
  onAutoLayout: () => void;
  pendingShape: DiagramShapeKind | null;
  onPendingShape: (kind: DiagramShapeKind | null) => void;
};

function Tool(props: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode; text?: string }) {
  return (
    <Tooltip title={props.label} arrow>
      <span>
        <ButtonBase
          aria-label={props.label}
          aria-pressed={props.active}
          disabled={props.disabled}
          onClick={props.onClick}
          sx={{
            height: 30,
            minWidth: 30,
            px: props.text ? 1 : 0.5,
            gap: 0.5,
            borderRadius: 1,
            border: "1px solid",
            borderColor: props.active ? "primary.main" : "divider",
            color: props.active ? "primary.main" : "text.secondary",
            bgcolor: props.active ? "rgba(25,118,210,0.08)" : "background.paper",
            "&:hover": { bgcolor: "action.hover" },
            "&.Mui-disabled": { opacity: 0.38 },
            "& svg": { fontSize: 17 },
          }}
        >
          {props.children}
          {props.text && (
            <Typography component="span" sx={{ fontSize: 11, fontWeight: props.active ? 700 : 500 }}>
              {props.text}
            </Typography>
          )}
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={0.25} sx={{ flexShrink: 0 }}>
      <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: "text.disabled", textTransform: "uppercase", letterSpacing: 0.4, lineHeight: 1.2 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={0.5}>{children}</Stack>
    </Stack>
  );
}

const Divider = () => <Box sx={{ width: "1px", alignSelf: "stretch", bgcolor: "divider", mx: 0.25 }} />;

const SHAPE_TOOLS: { kind: DiagramShapeKind; Icon: typeof CircleOutlined }[] = [
  { kind: "RECTANGLE", Icon: CheckBoxOutlineBlankOutlined },
  { kind: "ELLIPSE", Icon: CircleOutlined },
  { kind: "TEXT", Icon: TextFieldsOutlined },
  { kind: "NOTE", Icon: StickyNote2Outlined },
];

/**
 * The diagram's toolbar: navigation, zoom, grid, and the layout tools that work
 * on the current selection — each enabled only when the selection allows it.
 * Everything here changes how the diagram looks, never what it governs.
 */
export function DiagramToolbar(p: DiagramToolbarProps) {
  const many = p.selectedCount >= 2;
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={0.75} alignItems="flex-end" sx={{ flexShrink: 0 }}>
      <Section title="Navigate">
        <Tool label="Select — click or drag a box to select" active={p.mode === "select"} onClick={() => p.onMode("select")} text="Select">
          <NearMeOutlined />
        </Tool>
        <Tool label="Pan — drag to move around" active={p.mode === "pan"} onClick={() => p.onMode("pan")} text="Pan">
          <PanToolOutlined />
        </Tool>
      </Section>
      <Divider />
      <Section title="Zoom">
        <Tool label="Zoom out" onClick={p.onZoomOut}><ZoomOutOutlined /></Tool>
        <Tool label="Reset to 100%" onClick={p.onZoomReset} text={`${p.zoomPercent}%`}>{null}</Tool>
        <Tool label="Zoom in" onClick={p.onZoomIn}><ZoomInOutlined /></Tool>
        <Tool label="Fit to view" onClick={p.onFit}><CropFreeOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Grid">
        <Tool label={p.grid ? "Hide grid" : "Show grid"} active={p.grid} onClick={p.onToggleGrid}><GridOnOutlined /></Tool>
        <Tool label={p.snap ? "Turn off snap to grid" : "Snap to grid"} active={p.snap} onClick={p.onToggleSnap}><GridGoldenratioOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Align">
        <Tool label="Align left" disabled={!many} onClick={() => p.onAlign("left")}><AlignHorizontalLeft /></Tool>
        <Tool label="Align centre" disabled={!many} onClick={() => p.onAlign("center")}><AlignHorizontalCenter /></Tool>
        <Tool label="Align right" disabled={!many} onClick={() => p.onAlign("right")}><AlignHorizontalRight /></Tool>
        <Tool label="Align top" disabled={!many} onClick={() => p.onAlign("top")}><AlignVerticalTop /></Tool>
        <Tool label="Align middle" disabled={!many} onClick={() => p.onAlign("middle")}><AlignVerticalCenter /></Tool>
        <Tool label="Align bottom" disabled={!many} onClick={() => p.onAlign("bottom")}><AlignVerticalBottom /></Tool>
      </Section>
      <Divider />
      <Section title="Distribute">
        <Tool label="Distribute horizontally (3 or more)" disabled={p.selectedCount < 3} onClick={() => p.onDistribute("horizontal")}>
          <HeightOutlined sx={{ transform: "rotate(90deg)" }} />
        </Tool>
        <Tool label="Distribute vertically (3 or more)" disabled={p.selectedCount < 3} onClick={() => p.onDistribute("vertical")}>
          <HeightOutlined />
        </Tool>
      </Section>
      <Divider />
      <Section title="Arrange">
        <Tool label="Bring to front" disabled={p.selectedCount === 0} onClick={() => p.onArrange("front")}><FlipToFrontOutlined /></Tool>
        <Tool label="Bring forward" disabled={p.selectedCount === 0} onClick={() => p.onArrange("forward")}><ArrowUpwardOutlined /></Tool>
        <Tool label="Send backward" disabled={p.selectedCount === 0} onClick={() => p.onArrange("backward")}><ArrowDownwardOutlined /></Tool>
        <Tool label="Send to back" disabled={p.selectedCount === 0} onClick={() => p.onArrange("back")}><FlipToBackOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Rotate">
        <Tool label="Rotate left (annotations)" disabled={p.selectedShapeCount === 0} onClick={() => p.onRotate(-90)}><RotateLeftOutlined /></Tool>
        <Tool label="Rotate right (annotations)" disabled={p.selectedShapeCount === 0} onClick={() => p.onRotate(90)}><RotateRightOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Group">
        <Tool label="Group selected" disabled={!p.canGroup} onClick={p.onGroup}><GroupWorkOutlined /></Tool>
        <Tool label="Ungroup" disabled={!p.canUngroup} onClick={p.onUngroup}><LayersClearOutlined /></Tool>
        <Tool label="Regroup the last group taken apart" disabled={!p.canRegroup} onClick={p.onRegroup}><RestorePageOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Layout">
        <Tool label="Auto layout" onClick={p.onAutoLayout}><AutoFixHighOutlined /></Tool>
      </Section>
      <Divider />
      <Section title="Annotate">
        {SHAPE_TOOLS.map(({ kind, Icon }) => (
          <Tool
            key={kind}
            label={`${DIAGRAM_SHAPE_LABELS[kind]} — click the canvas to place`}
            active={p.pendingShape === kind}
            onClick={() => p.onPendingShape(p.pendingShape === kind ? null : kind)}
          >
            <Icon />
          </Tool>
        ))}
      </Section>
      {p.pendingShape && (
        <Typography variant="caption" color="primary.main" sx={{ fontSize: 11, alignSelf: "center" }}>
          Click the canvas to place — Esc to cancel
        </Typography>
      )}
    </Stack>
  );
}
