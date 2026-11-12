import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { DiagramShape, EdgeStyle } from "@/features/cross-model";
import type { ModelItemKind, ModelKind } from "@/shared/constants/ModelConfig";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InstanceSelection {
  instances: Array<{
    id: string;
    name: string;
    kind: ModelKind;
    modelId: string;
    modelName: string;
  }>;
}

interface DiagramItem {
  id: string;
  name: string;
  typeName: string;
  modelName?: string;
  kind: ModelItemKind;
  /** Persisted canvas position; undefined until dragged or a saved diagram is loaded. */
  x?: number;
  y?: number;
}

interface MatrixViewSelection {
  sourceSelection: InstanceSelection | null;
  targetSelection: InstanceSelection | null;
}

interface DiagramViewSelection {
  canvasItems: DiagramItem[];
  /** Per-connection line-style overrides, keyed by ReactFlow edge id. Absent = "curved". */
  edgeStyles: Record<string, EdgeStyle>;
  /** Drawn annotations on the canvas — decoration, not business data. */
  shapes: DiagramShape[];
  /**
   * The saved diagram the canvas belongs to. Held here rather than in the view so
   * that leaving the tab and coming back keeps editing the same diagram instead of
   * re-opening the most recent one over unsaved work.
   */
  currentDiagramId: string | null;
  currentDiagramName: string | null;
}

interface CrossModelRelationshipState {
  matrixViewSelection: MatrixViewSelection;
  diagramViewSelection: DiagramViewSelection;
}

interface StructureWorkspaceContextValue {
  crossModelRelationship: CrossModelRelationshipState;
  setMatrixSourceSelection: (selection: InstanceSelection | null) => void;
  setMatrixTargetSelection: (selection: InstanceSelection | null) => void;
  setDiagramCanvasItems: (items: DiagramItem[] | ((prev: DiagramItem[]) => DiagramItem[])) => void;
  setDiagramEdgeStyles: Dispatch<SetStateAction<Record<string, EdgeStyle>>>;
  setDiagramShapes: Dispatch<SetStateAction<DiagramShape[]>>;
  setCurrentDiagramId: Dispatch<SetStateAction<string | null>>;
  setCurrentDiagramName: Dispatch<SetStateAction<string | null>>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const StructureWorkspaceContext = createContext<StructureWorkspaceContextValue | undefined>(undefined);

export function StructureWorkspaceProvider({ children }: { children: ReactNode }) {
  // Matrix view state
  const [matrixSourceSelection, setMatrixSourceSelection] = useState<InstanceSelection | null>(null);
  const [matrixTargetSelection, setMatrixTargetSelection] = useState<InstanceSelection | null>(null);

  // Diagram view state
  const [diagramCanvasItems, setDiagramCanvasItems] = useState<DiagramItem[]>([]);
  const [diagramEdgeStyles, setDiagramEdgeStyles] = useState<Record<string, EdgeStyle>>({});
  const [diagramShapes, setDiagramShapes] = useState<DiagramShape[]>([]);
  const [currentDiagramId, setCurrentDiagramId] = useState<string | null>(null);
  const [currentDiagramName, setCurrentDiagramName] = useState<string | null>(null);

  const value: StructureWorkspaceContextValue = {
    crossModelRelationship: {
      matrixViewSelection: {
        sourceSelection: matrixSourceSelection,
        targetSelection: matrixTargetSelection,
      },
      diagramViewSelection: {
        canvasItems: diagramCanvasItems,
        edgeStyles: diagramEdgeStyles,
        shapes: diagramShapes,
        currentDiagramId,
        currentDiagramName,
      },
    },
    setMatrixSourceSelection,
    setMatrixTargetSelection,
    setDiagramCanvasItems,
    setDiagramEdgeStyles,
    setDiagramShapes,
    setCurrentDiagramId,
    setCurrentDiagramName,
  };

  return (
    <StructureWorkspaceContext.Provider value={value}>
      {children}
    </StructureWorkspaceContext.Provider>
  );
}

export function useStructureWorkspace() {
  const context = useContext(StructureWorkspaceContext);
  if (context === undefined) {
    throw new Error("useStructureWorkspace must be used within a StructureWorkspaceProvider");
  }
  return context;
}

// ── Export types ──────────────────────────────────────────────────────────────

export type { InstanceSelection, DiagramItem };
