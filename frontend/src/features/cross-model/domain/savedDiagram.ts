import type { ModelItemKind } from "@/shared/constants/ModelConfig";
import type { EdgeStyle } from "./edgeStyle";
import type { DiagramShapeKind } from "./diagramShape";

export type SavedDiagramNode = {
  itemId: string;
  itemKind: ModelItemKind;
  posX: number;
  posY: number;
};

/**
 * A per-connection line style. `edgeKey` is the ReactFlow edge id, which is stable
 * per workspace: the cross-model instance id at the instance level, and the
 * `sourceTypeId__targetTypeId` pair at the type level. Every connection on the
 * canvas is stored, including ones left at the default ("curved"), so a saved
 * diagram fully describes how it renders. Keys whose connection no longer exists
 * are ignored on load.
 */
export type SavedDiagramEdge = {
  edgeKey: string;
  edgeStyle: EdgeStyle;
};

/**
 * A drawn annotation persisted with the diagram. Shapes have no server identity —
 * saving replaces the diagram's whole shape set — so no id travels with them.
 */
export type SavedDiagramShape = {
  kind: DiagramShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** Style overrides; null means "use the kind's default". */
  strokeColor?: string | null;
  textColor?: string | null;
  fontSize?: number | null;
  /** Stacking order; null sits on the default shape layer. */
  zIndex?: number | null;
};

export type SavedDiagramSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
};

export type SavedDiagram = SavedDiagramSummary & {
  nodes: SavedDiagramNode[];
  edges: SavedDiagramEdge[];
  /** Empty on workspaces that don't offer annotations, and on diagrams saved before they existed. */
  shapes: SavedDiagramShape[];
};

export type SaveDiagramInput = {
  name: string;
  nodes: SavedDiagramNode[];
  edges: SavedDiagramEdge[];
  shapes?: SavedDiagramShape[];
};

/** CRUD surface a workspace injects into the shared SavedDiagramsBar. */
export type SavedDiagramApi = {
  list: () => Promise<SavedDiagramSummary[]>;
  get: (id: string) => Promise<SavedDiagram>;
  create: (input: SaveDiagramInput) => Promise<SavedDiagram>;
  update: (id: string, input: SaveDiagramInput) => Promise<SavedDiagram>;
  remove: (id: string) => Promise<unknown>;
};
