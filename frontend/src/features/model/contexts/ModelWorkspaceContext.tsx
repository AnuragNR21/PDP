import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { DiagramShape, EdgeStyle } from "@/features/cross-model";
import type { ModelItemKind } from "@/shared/constants/ModelConfig";
import type { CrossModelTypeOption } from "../domain/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatrixTypeSelection {
  sourceTypes: CrossModelTypeOption[];
  targetTypes: CrossModelTypeOption[];
}

/** A node/element type placed on the cross-model relationship Diagram View canvas. */
export interface DiagramTypeItem {
  id: string;
  name: string;
  modelName?: string;
  kind: ModelItemKind;
  /** Persisted canvas position; undefined until the node is dragged or a saved diagram is loaded. */
  x?: number;
  y?: number;
}

interface ModelWorkspaceContextValue {
  matrixTypeSelection: MatrixTypeSelection;
  setMatrixSourceTypes: (types: CrossModelTypeOption[]) => void;
  setMatrixTargetTypes: (types: CrossModelTypeOption[]) => void;
  diagramCanvasItems: DiagramTypeItem[];
  setDiagramCanvasItems: Dispatch<SetStateAction<DiagramTypeItem[]>>;
  /** Per-connection line-style overrides, keyed by ReactFlow edge id. Absent = "curved". */
  diagramEdgeStyles: Record<string, EdgeStyle>;
  setDiagramEdgeStyles: Dispatch<SetStateAction<Record<string, EdgeStyle>>>;
  /** Drawn annotations on the canvas — decoration, not business data. */
  diagramShapes: DiagramShape[];
  setDiagramShapes: Dispatch<SetStateAction<DiagramShape[]>>;
  /**
   * The saved diagram the canvas belongs to. Held here rather than in the view so
   * that leaving the tab and coming back keeps editing the same diagram instead of
   * re-opening the most recent one over unsaved work.
   */
  currentDiagramId: string | null;
  setCurrentDiagramId: Dispatch<SetStateAction<string | null>>;
  currentDiagramName: string | null;
  setCurrentDiagramName: Dispatch<SetStateAction<string | null>>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ModelWorkspaceContext = createContext<ModelWorkspaceContextValue | undefined>(undefined);

export function ModelWorkspaceProvider({ children }: { children: ReactNode }) {
  const [sourceTypes, setSourceTypes] = useState<CrossModelTypeOption[]>([]);
  const [targetTypes, setTargetTypes] = useState<CrossModelTypeOption[]>([]);
  const [diagramCanvasItems, setDiagramCanvasItems] = useState<DiagramTypeItem[]>([]);
  const [diagramEdgeStyles, setDiagramEdgeStyles] = useState<Record<string, EdgeStyle>>({});
  const [diagramShapes, setDiagramShapes] = useState<DiagramShape[]>([]);
  const [currentDiagramId, setCurrentDiagramId] = useState<string | null>(null);
  const [currentDiagramName, setCurrentDiagramName] = useState<string | null>(null);

  const value: ModelWorkspaceContextValue = {
    matrixTypeSelection: { sourceTypes, targetTypes },
    setMatrixSourceTypes: setSourceTypes,
    setMatrixTargetTypes: setTargetTypes,
    diagramCanvasItems,
    setDiagramCanvasItems,
    diagramEdgeStyles,
    setDiagramEdgeStyles,
    diagramShapes,
    setDiagramShapes,
    currentDiagramId,
    setCurrentDiagramId,
    currentDiagramName,
    setCurrentDiagramName,
  };

  return (
    <ModelWorkspaceContext.Provider value={value}>
      {children}
    </ModelWorkspaceContext.Provider>
  );
}

export function useModelWorkspace() {
  const context = useContext(ModelWorkspaceContext);
  if (context === undefined) {
    throw new Error("useModelWorkspace must be used within a ModelWorkspaceProvider");
  }
  return context;
}

export type { MatrixTypeSelection };
