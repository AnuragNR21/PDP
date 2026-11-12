import SwapVertOutlined from "@mui/icons-material/SwapVertOutlined";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListSubheader, MenuItem, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { CrossModelRelationshipTypeSummary } from "@/features/model/domain/types";
import type { ModelKind } from "@/shared/constants/ModelConfig";
import {
  useActiveCrossModelRelationshipTypes,
  useCreateCrossModelLink,
  useElementInstances,
  useHierarchyModels,
  useModelNodeInstances,
  useSupportDomainModels,
} from "@/features/structure/state/useStructureWorkspace";
import { flattenTree } from "./instanceEditors";

type EndOption = { id: string; name: string; typeId: string };

/** One end of a relationship: which model, and which instance in it. */
export type LinkEnd = { kind: ModelKind | ""; modelId: string; instanceId: string };
const EMPTY_END: LinkEnd = { kind: "", modelId: "", instanceId: "" };

/** What the opening action already knows — a dragged pair, a duplicated row, the selected instance. */
export type LinkPreset = { typeId?: string; source?: Partial<LinkEnd>; target?: Partial<LinkEnd> };

function useEndOptions(kind: ModelKind | "", modelId: string) {
  const nodes = useModelNodeInstances(kind === "HIERARCHY_MODEL" && modelId ? modelId : null);
  const elements = useElementInstances(kind === "SUPPORT_DOMAIN_MODEL" && modelId ? modelId : null);
  return useMemo<EndOption[]>(
    () =>
      kind === "HIERARCHY_MODEL"
        ? flattenTree(nodes.data ?? []).map((node) => ({ id: node.node_id, name: node.name, typeId: node.node_type_id }))
        : kind === "SUPPORT_DOMAIN_MODEL" && modelId
          ? (elements.data ?? []).map((element) => ({ id: element.instance_id, name: element.name, typeId: element.element_type_id }))
          : [],
    [kind, modelId, nodes.data, elements.data],
  );
}

export function describeGovernedType(type: CrossModelRelationshipTypeSummary) {
  const end = (model: string | null, name: string | null, kind: string) =>
    name ? `${model ?? ""}${model ? " › " : ""}${name}` : `any ${kind === "HIERARCHY_MODEL" ? "hierarchy" : "support domain"} item`;
  return `${type.name}: ${end(type.sourceModelName, type.sourceTypeName, type.sourceModelType)} → ${end(type.targetModelName, type.targetTypeName, type.targetModelType)}`;
}

/** Does `type` allow this end on this side? An end not chosen yet (or its instance type) does not narrow. */
function fits(type: CrossModelRelationshipTypeSummary, side: "source" | "target", end: LinkEnd, itemTypeId?: string) {
  const kind = side === "source" ? type.sourceModelType : type.targetModelType;
  const modelId = side === "source" ? type.sourceModelId : type.targetModelId;
  const typeId = side === "source" ? type.sourceModelItemTypeId : type.targetModelItemTypeId;
  if (end.kind && kind !== end.kind) return false;
  if (end.modelId && modelId && modelId !== end.modelId) return false;
  if (itemTypeId && typeId && typeId !== itemTypeId) return false;
  return true;
}

/**
 * The Relationship Editor of the Structure Workspace.
 *
 * The Model Workspace defines which relationships are allowed between which
 * types; here one of those is applied between two instances. Source and
 * target come first — filled in already when the editor was opened by a drag
 * on the diagram, a duplicated row or a selected instance — and each list
 * offers only what the model allows next to the other end. The relationship
 * is then one of the types allowed for that pair: picked for you when there is
 * exactly one, never one the model does not allow, and never a new one.
 */
export function CrossModelLinkDialog(props: { open: boolean; preset?: LinkPreset; onClose: () => void }) {
  const governed = useActiveCrossModelRelationshipTypes();
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const create = useCreateCrossModelLink();

  const [source, setSource] = useState<LinkEnd>(EMPTY_END);
  const [target, setTarget] = useState<LinkEnd>(EMPTY_END);
  const [typeId, setTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setSource({ ...EMPTY_END, ...props.preset?.source });
    setTarget({ ...EMPTY_END, ...props.preset?.target });
    setTypeId(props.preset?.typeId ?? "");
    setError(null);
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = governed.data ?? [];
  const sourceOptions = useEndOptions(source.kind, source.modelId);
  const targetOptions = useEndOptions(target.kind, target.modelId);
  const sourceItemType = sourceOptions.find((item) => item.id === source.instanceId)?.typeId;
  const targetItemType = targetOptions.find((item) => item.id === target.instanceId)?.typeId;

  const fitsBoth = (type: CrossModelRelationshipTypeSummary, s: LinkEnd, sType: string | undefined, t: LinkEnd, tType: string | undefined) =>
    fits(type, "source", s, sType) && fits(type, "target", t, tType);

  // The relationships allowed between the two ends as chosen so far.
  const allowed = useMemo(
    () => types.filter((type) => fitsBoth(type, source, sourceItemType, target, targetItemType)),
    [types, source, target, sourceItemType, targetItemType], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const complete = Boolean(source.instanceId && target.instanceId && sourceItemType && targetItemType);

  // Exactly one allowed relationship is picked for you; one that no longer fits is dropped.
  useEffect(() => {
    if (!props.open || !complete) return;
    if (allowed.some((type) => type.id === typeId)) return;
    setTypeId(allowed.length === 1 ? allowed[0].id : "");
  }, [props.open, complete, allowed, typeId]);

  const models = useMemo(
    () => [
      ...(hierarchyModels.data ?? []).map((model) => ({ kind: "HIERARCHY_MODEL" as ModelKind, id: model.id, name: model.name })),
      ...(supportModels.data ?? []).map((model) => ({ kind: "SUPPORT_DOMAIN_MODEL" as ModelKind, id: model.id, name: model.name })),
    ],
    [hierarchyModels.data, supportModels.data],
  );
  // Models and instances are offered only where some allowed relationship could still follow.
  const modelsFor = (side: "source" | "target") => {
    const other = side === "source" ? target : source;
    const otherType = side === "source" ? targetItemType : sourceItemType;
    return models.filter((model) =>
      types.some((type) => {
        const end: LinkEnd = { kind: model.kind, modelId: model.id, instanceId: "" };
        return side === "source" ? fitsBoth(type, end, undefined, other, otherType) : fitsBoth(type, other, otherType, end, undefined);
      }),
    );
  };
  const instancesFor = (side: "source" | "target") => {
    const end = side === "source" ? source : target;
    const options = side === "source" ? sourceOptions : targetOptions;
    const other = side === "source" ? target : source;
    const otherType = side === "source" ? targetItemType : sourceItemType;
    const otherId = other.instanceId;
    return options.filter(
      (option) =>
        option.id !== otherId &&
        types.some((type) => (side === "source" ? fitsBoth(type, end, option.typeId, other, otherType) : fitsBoth(type, other, otherType, end, option.typeId))),
    );
  };

  const swap = () => {
    setSource(target);
    setTarget(source);
  };

  const type = allowed.find((item) => item.id === typeId) ?? null;
  const submit = async () => {
    if (!type || !complete || !source.kind || !target.kind) return;
    setError(null);
    try {
      await create.mutateAsync({
        relationship_rule_id: type.id,
        source_instance_id: source.instanceId,
        source_instance_type: source.kind,
        target_instance_id: target.instanceId,
        target_instance_type: target.kind,
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the relationship.");
    }
  };

  const endFields = (side: "source" | "target") => {
    const label = side === "source" ? "Source" : "Target";
    const end = side === "source" ? source : target;
    const set = side === "source" ? setSource : setTarget;
    const modelOptions = modelsFor(side);
    // A preset end whose model is not in the filtered list is still shown, so it can be read and changed.
    const current = models.find((model) => model.id === end.modelId);
    const listed = current && !modelOptions.some((model) => model.id === current.id) ? [current, ...modelOptions] : modelOptions;
    const instances = instancesFor(side);
    const instanceListed = end.instanceId && !instances.some((option) => option.id === end.instanceId)
      ? [...(side === "source" ? sourceOptions : targetOptions).filter((option) => option.id === end.instanceId), ...instances]
      : instances;
    const group = (kind: ModelKind) => listed.filter((model) => model.kind === kind);
    return (
      <Stack direction="row" spacing={1.5}>
        <TextField
          select
          size="small"
          label={`${label} model`}
          value={end.modelId ? `${end.kind}|${end.modelId}` : ""}
          onChange={(event) => {
            const [kind, modelId] = event.target.value.split("|");
            set({ kind: kind as ModelKind, modelId, instanceId: "" });
          }}
          sx={{ flex: 1 }}
        >
          {listed.length === 0 && <MenuItem value="" disabled>No model can take part</MenuItem>}
          {group("HIERARCHY_MODEL").length > 0 && <ListSubheader>Hierarchy models</ListSubheader>}
          {group("HIERARCHY_MODEL").map((model) => (
            <MenuItem key={model.id} value={`${model.kind}|${model.id}`}>{model.name}</MenuItem>
          ))}
          {group("SUPPORT_DOMAIN_MODEL").length > 0 && <ListSubheader>Support domain models</ListSubheader>}
          {group("SUPPORT_DOMAIN_MODEL").map((model) => (
            <MenuItem key={model.id} value={`${model.kind}|${model.id}`}>{model.name}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={`${label} instance`}
          value={end.instanceId}
          onChange={(event) => set({ ...end, instanceId: event.target.value })}
          disabled={!end.modelId}
          sx={{ flex: 1 }}
        >
          {instanceListed.length === 0 && <MenuItem value="" disabled>No allowed instances</MenuItem>}
          {instanceListed.map((option) => (
            <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
          ))}
        </TextField>
      </Stack>
    );
  };

  const sourceName = sourceOptions.find((item) => item.id === source.instanceId)?.name;
  const targetName = targetOptions.find((item) => item.id === target.instanceId)?.name;

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Relationship</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {endFields("source")}
          <Box sx={{ display: "flex", justifyContent: "center", my: "-8px !important" }}>
            <Tooltip title="Swap source and target">
              <span>
                <IconButton size="small" aria-label="Swap source and target" onClick={swap} disabled={!source.modelId && !target.modelId}>
                  <SwapVertOutlined fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          {endFields("target")}
          <TextField
            select
            size="small"
            label="Relationship"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            disabled={!complete || allowed.length === 0}
            required
            helperText={
              !complete
                ? "Choose the source and target instances first."
                : allowed.length === 1
                  ? "The only relationship the Model Workspace allows between these types."
                  : allowed.length > 1
                    ? `${allowed.length} relationships are allowed between these types.`
                    : undefined
            }
          >
            {allowed.map((item) => (
              <MenuItem key={item.id} value={item.id}>{describeGovernedType(item)}</MenuItem>
            ))}
          </TextField>
          {complete && allowed.length === 0 && (
            <Alert severity="warning">
              The Model Workspace allows no relationship from {sourceName ?? "the source"}'s type to {targetName ?? "the target"}'s type. Define one there first,
              or swap the two if it runs the other way.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            The Model Workspace defines which relationships are allowed; this creates one between two instances. It cannot create or change a relationship type.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={!type || !complete || create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
