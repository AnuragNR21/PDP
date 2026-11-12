import type { ReactNode } from "react";
import { StructureWorkspaceProvider } from "@/features/structure/contexts/StructureWorkspaceContext";
import { ModelWorkspaceProvider } from "@/features/model/contexts/ModelWorkspaceContext";

/**
 * GlobalContextProvider wraps all workspace-level contexts at the root of the
 * app so their state persists across route navigation.
 *
 * Add new workspace/feature contexts here as the app grows.
 */
export function GlobalContextProvider({ children }: { children: ReactNode }) {
  return (
    <StructureWorkspaceProvider>
      <ModelWorkspaceProvider>
        {children}
      </ModelWorkspaceProvider>
    </StructureWorkspaceProvider>
  );
}
