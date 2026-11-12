import { Alert, Chip, MenuItem, TextField, Tooltip } from "@mui/material";
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import { useMemo } from "react";
import {
  useHierarchyModels,
  useModelNodeTypes,
  useSupportDomainElementTypes,
  useSupportDomainModels,
} from "@/features/structure/state/useStructureWorkspace";

/**
 * Lifecycle between MWS definitions and SWS instances: Draft → Active →
 * Archived. The third state is stored as "retired" and shown as "Archived".
 * The server enforces the same rules (shared/lifecycle.py); these only let the
 * screen say so before a save has to.
 *
 *   MWS definition   Draft inst.   Active inst.   Archived inst.   New instance
 *   Draft            no            no             historical       no
 *   Active           yes           yes            yes              yes
 *   Archived         no            no             yes              no
 */
export const DRAFT = "draft";
export const ACTIVE = "active";
export const ARCHIVED = "retired";
export const INSTANCE_STATUSES = [DRAFT, ACTIVE, ARCHIVED] as const;

export { lifecycleLabel };

/** Model and type together: Archived if either is, else Draft if either is, else Active. */
export function combinedStatus(modelStatus?: string | null, typeStatus?: string | null) {
  const statuses = [modelStatus ?? ACTIVE, typeStatus ?? ACTIVE];
  if (statuses.includes(ARCHIVED)) return ARCHIVED;
  if (statuses.includes(DRAFT)) return DRAFT;
  return ACTIVE;
}

export function instanceStatusAllowed(definitionStatus: string, instanceStatus: string) {
  return definitionStatus === ACTIVE ? (INSTANCE_STATUSES as readonly string[]).includes(instanceStatus) : instanceStatus === ARCHIVED;
}

/** What governs an instance, and why it is not Active when it is not. */
export type Definition = { status: string; reason: string | null; loading: boolean };

export function definitionOf(kindWord: "Node Type" | "Element Type", model?: { name: string; status: string } | null, type?: { name: string; status: string } | null): Omit<Definition, "loading"> {
  const status = combinedStatus(model?.status, type?.status);
  let reason: string | null = null;
  if (model && model.status !== ACTIVE) reason = `Model “${model.name}” is ${lifecycleLabel(model.status)}`;
  else if (type && type.status !== ACTIVE) reason = `${kindWord} “${type.name}” is ${lifecycleLabel(type.status)}`;
  return { status, reason };
}

/** The governing definition of an SWS instance, from the model and type lists already cached. */
export function useInstanceDefinition(kind: "node" | "element", modelId: string | null | undefined, typeId: string | null | undefined): Definition {
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const nodeTypes = useModelNodeTypes(kind === "node" ? modelId ?? null : null);
  const elementTypes = useSupportDomainElementTypes(kind === "element" ? modelId ?? null : null);
  return useMemo(() => {
    if (kind === "node") {
      const model = (hierarchyModels.data ?? []).find((m) => m.id === modelId);
      const type = (nodeTypes.data ?? []).find((t) => t.id === typeId);
      return { ...definitionOf("Node Type", model, type ? { name: type.displayName || type.name, status: type.status } : null), loading: hierarchyModels.isLoading || nodeTypes.isLoading };
    }
    const model = (supportModels.data ?? []).find((m) => m.id === modelId);
    const type = (elementTypes.data ?? []).find((t) => t.id === typeId);
    return { ...definitionOf("Element Type", model, type ? { name: type.displayName || type.name, status: type.status } : null), loading: supportModels.isLoading || elementTypes.isLoading };
  }, [kind, modelId, typeId, hierarchyModels.data, hierarchyModels.isLoading, supportModels.data, supportModels.isLoading, nodeTypes.data, nodeTypes.isLoading, elementTypes.data, elementTypes.isLoading]);
}

/** A small status chip — nothing for Active, which is the normal case. */
export function LifecycleChip({ status, showActive = false }: { status?: string | null; showActive?: boolean }) {
  if (!status || (status === ACTIVE && !showActive)) return null;
  const archived = status === ARCHIVED;
  return (
    <Chip
      size="small"
      variant="outlined"
      label={lifecycleLabel(status)}
      color={status === ACTIVE ? "success" : archived ? "default" : "warning"}
      sx={{ height: 18, fontSize: 10, flexShrink: 0, ...(archived ? { borderStyle: "dashed", color: "text.secondary" } : {}) }}
    />
  );
}

/**
 * The Status field of an SWS instance: Draft / Active / Archived, with the
 * states its MWS definition does not allow disabled and explained, and a
 * warning when the instance is already in such a state (left from before the
 * rules, never created by them).
 */
export function InstanceStatusField(props: { value: string; current: string; definition: Definition; onChange: (status: string) => void; disabled?: boolean }) {
  const { definition } = props;
  const invalidNow = !definition.loading && !instanceStatusAllowed(definition.status, props.current);
  return (
    <>
      <TextField
        select
        size="small"
        fullWidth
        label="Status"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        helperText={
          definition.status === ACTIVE
            ? "Draft, Active or Archived."
            : `${definition.reason ?? "The definition is not Active"} in the Model Workspace, so this instance can only be Archived.`
        }
      >
        {INSTANCE_STATUSES.map((status) => {
          const allowed = instanceStatusAllowed(definition.status, status);
          return (
            <MenuItem key={status} value={status} disabled={!allowed && status !== props.current}>
              <Tooltip title={allowed ? "" : `${definition.reason ?? "The definition is not Active"} — activate it in the Model Workspace first.`} placement="right">
                <span>{lifecycleLabel(status)}</span>
              </Tooltip>
            </MenuItem>
          );
        })}
      </TextField>
      {invalidNow && (
        <Alert severity="warning" sx={{ py: 0 }}>
          This instance is {lifecycleLabel(props.current)}, but {definition.reason?.replace(/^./, (c) => c.toLowerCase()) ?? "its definition is not Active"} in the Model Workspace — not a valid combination. Archive it here, or activate the definition there.
        </Alert>
      )}
    </>
  );
}
