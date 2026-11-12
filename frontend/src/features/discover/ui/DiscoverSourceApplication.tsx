import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverApi, type SourceApplicationItem } from "@/features/discover/api/discoverApi";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { modelDefinitionsApi } from "@/features/model/api/modelDefinitionsApi";
import { structureApi } from "@/features/structure/api/structureApi";
import { useHierarchyModels, useSupportDomainModels } from "@/features/structure/state/useStructureWorkspace";
import { ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import { lifecycleLabel } from "@/shared/constants/lifecycle";

/**
 * Source application context — where a Discover table came from.
 *
 *   Application → Source table → Source column → Asset property → Finding → Remediation
 *
 * Import Data records the first link: the Application (an instance of a
 * governed model, such as GIS in the Applications model) that produced the
 * table. Mapping records what the columns mean, against whatever model fits
 * them. The two are separate relationships, and both are kept.
 *
 * Nothing is read from the file name: an unset table says "Not selected"
 * until someone chooses.
 */

type VM = ReturnType<typeof useDiscoverWorkspace>;
type ModelKind = "hierarchy" | "support";
type ModelOption = { kind: ModelKind; id: string; name: string; status: string };
type InstanceOption = { id: string; name: string; typeId: string; typeName: string; status: string };

const ARCHIVED = "retired";

export function useSourceApplications(sessionId: string) {
  return useQuery({
    queryKey: ["discover", "sourceApplications", sessionId],
    queryFn: async () => (await discoverApi.listSourceApplications(sessionId)).items,
    enabled: sessionId.length > 0,
  });
}

/** The Application of one table, or undefined while loading. */
export function useSourceApplicationOf(sessionId: string, sourceFileId: string | null | undefined) {
  const query = useSourceApplications(sessionId);
  return useMemo(
    () => (sourceFileId ? query.data?.find((item) => item.source_file_id === sourceFileId) : undefined),
    [query.data, sourceFileId],
  );
}

function applicationLabel(item: SourceApplicationItem | undefined) {
  const app = item?.application;
  if (!app) return null;
  return app.instance_name ?? "(deleted application)";
}

/** One line per table on Import Data: "Application: GIS · Applications  [Change]". */
export function SourceApplicationLine({ vm, sourceFileId, tableName }: { vm: VM; sourceFileId: string; tableName: string }) {
  const item = useSourceApplicationOf(vm.selectedSessionId, sourceFileId);
  const [open, setOpen] = useState(false);
  const app = item?.application ?? null;
  return (
    <>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5, minWidth: 0 }}>
        <AppsOutlinedIcon sx={{ fontSize: 15, color: app ? "primary.main" : "text.disabled" }} />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          Application:
        </Typography>
        {app ? (
          <Tooltip title={`${app.instance_type_name ?? "Instance"} in ${app.model_name ?? "a deleted model"} — recorded explicitly, not read from the file name`}>
            <Chip
              size="small"
              color={app.missing ? "warning" : "primary"}
              variant="outlined"
              icon={app.missing ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : undefined}
              label={
                <span>
                  <b>{applicationLabel(item)}</b>
                  {app.model_name ? <span style={{ opacity: 0.7 }}> · {app.model_name}</span> : null}
                </span>
              }
              sx={{ height: 20, fontSize: 11, maxWidth: 260 }}
            />
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.disabled" fontStyle="italic">
            Not selected
          </Typography>
        )}
        <Button
          size="small"
          startIcon={app ? <EditOutlinedIcon sx={{ fontSize: "14px !important" }} /> : undefined}
          onClick={() => setOpen(true)}
          disabled={!item}
          sx={{ textTransform: "none", fontSize: 12, py: 0, minWidth: 0 }}
        >
          {app ? "Change" : "Choose application"}
        </Button>
      </Stack>
      {open && item && <SourceApplicationDialog vm={vm} item={item} tableName={tableName} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Read-only, for the headers of Mapping and Quality. */
export function SourceApplicationSummary({ vm, sourceFileId }: { vm: VM; sourceFileId: string | null | undefined }) {
  const item = useSourceApplicationOf(vm.selectedSessionId, sourceFileId);
  const app = item?.application ?? null;
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1}>
      <AppsOutlinedIcon sx={{ fontSize: 18, color: app ? "primary.main" : "text.disabled", mt: 0.25 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          Source application
        </Typography>
        {app ? (
          <Tooltip title={app.model_name ? `${app.instance_type_name ?? "Instance"} in ${app.model_name}` : ""}>
            <Typography variant="body2" fontWeight={600} noWrap color={app.missing ? "warning.main" : undefined}>
              {applicationLabel(item)}
              {app.missing ? " (no longer in PDP)" : ""}
            </Typography>
          </Tooltip>
        ) : (
          <Typography variant="body2" color="text.disabled" fontStyle="italic">
            Not selected
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function SourceApplicationDialog({ vm, item, tableName, onClose }: { vm: VM; item: SourceApplicationItem; tableName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const hierarchyModels = useHierarchyModels();
  const supportModels = useSupportDomainModels();
  const current = item.application;

  const models = useMemo<ModelOption[]>(() => {
    const all: ModelOption[] = [
      ...(hierarchyModels.data ?? []).map((m) => ({ kind: "hierarchy" as const, id: m.id, name: m.name, status: m.status })),
      ...(supportModels.data ?? []).map((m) => ({ kind: "support" as const, id: m.id, name: m.name, status: m.status })),
    ];
    return all.filter((m) => m.status === "active" || (current && m.id === current.model_id));
  }, [hierarchyModels.data, supportModels.data, current]);

  // A model that is about applications is offered first — suggested, never chosen for the user.
  const suggested = (m: ModelOption) => /application/i.test(m.name);
  const sortedModels = useMemo(
    () => [...models].sort((a, b) => Number(suggested(b)) - Number(suggested(a)) || a.name.localeCompare(b.name, undefined, { numeric: true })),
    [models],
  );

  const [modelKey, setModelKey] = useState<string>(current ? `${current.model_kind}:${current.model_id}` : "");
  const model = models.find((m) => `${m.kind}:${m.id}` === modelKey) ?? null;
  const [typeId, setTypeId] = useState<string>("");
  const [instance, setInstance] = useState<InstanceOption | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ["source-application-types", modelKey],
    enabled: Boolean(model),
    queryFn: async () => {
      if (!model) return [];
      const list =
        model.kind === "hierarchy"
          ? await modelDefinitionsApi.listHierarchyNodeTypes(model.id)
          : await modelDefinitionsApi.listSupportDomainElements(model.id);
      return list.map((t) => ({ id: t.id, name: t.displayName || t.name }));
    },
  });
  const instances = useQuery({
    queryKey: ["source-application-instances", modelKey],
    enabled: Boolean(model),
    queryFn: async (): Promise<InstanceOption[]> => {
      if (!model) return [];
      if (model.kind === "hierarchy") {
        const response = await structureApi.listNodesForModel(model.id);
        return response.items.map((n) => ({ id: n.node_id, name: n.name, typeId: n.node_type_id, typeName: "", status: n.status }));
      }
      const list = await structureApi.listElementInstances(model.id);
      return list.map((i) => ({ id: i.instance_id, name: i.name, typeId: i.element_type_id, typeName: i.element_type_name, status: i.status }));
    },
  });

  const typeName = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t.name])), [types.data]);
  const options = useMemo(
    () =>
      (instances.data ?? [])
        .filter((i) => i.status !== ARCHIVED)
        .filter((i) => !typeId || i.typeId === typeId)
        .map((i) => ({ ...i, typeName: i.typeName || typeName.get(i.typeId) || "" }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [instances.data, typeId, typeName],
  );

  // Default the type filter to an "Application" type when the model has one.
  useEffect(() => {
    if (!types.data || typeId) return;
    const app = types.data.find((t) => /^application/i.test(t.name));
    if (app) setTypeId(app.id);
  }, [types.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the current choice when reopening.
  useEffect(() => {
    if (!current || instance || !instances.data) return;
    const found = instances.data.find((i) => i.id === current.instance_id);
    if (found) setInstance({ ...found, typeName: found.typeName || typeName.get(found.typeId) || "" });
  }, [instances.data, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // The whole session scope, so Recent activity shows the change too.
  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "discover" && query.queryKey.includes(vm.selectedSessionId),
    });

  const save = useMutation({
    mutationFn: (confirm: boolean) =>
      discoverApi.setSourceApplication(vm.selectedSessionId, item.source_file_id, {
        model_kind: model!.kind,
        model_id: model!.id,
        instance_id: instance!.id,
        confirm,
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error: unknown) => {
      if ((error as { status?: number }).status === 409) setNeedsConfirm((error as Error).message);
    },
  });
  const clear = useMutation({
    mutationFn: (confirm: boolean) => discoverApi.clearSourceApplication(vm.selectedSessionId, item.source_file_id, confirm),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error: unknown) => {
      if ((error as { status?: number }).status === 409) setNeedsConfirm((error as Error).message);
    },
  });

  const busy = save.isPending || clear.isPending;
  const failure = [save.error, clear.error].find((e) => e && (e as { status?: number }).status !== 409) as Error | undefined;
  const unchanged = Boolean(current && model && instance && current.model_id === model.id && current.instance_id === instance.id);
  const { mappings, quality_findings } = item.dependents;
  const hasDependents = mappings + quality_findings > 0;
  const pendingClear = clear.isError && needsConfirm !== null;

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Source application</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Which application produced <b>{tableName}</b>? This records where the data came from (Application → table). It is
          separate from Mapping, which says what the columns mean.
        </Typography>
        <Stack spacing={2}>
          <TextField
            select
            size="small"
            label="Model"
            value={modelKey}
            onChange={(event) => {
              setModelKey(event.target.value);
              setTypeId("");
              setInstance(null);
              setNeedsConfirm(null);
            }}
            helperText="The model that holds your applications, e.g. Applications."
            SelectProps={{
              renderValue: () =>
                model ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ModelKindIcon kind={model.kind} size={20} />
                    <span>{model.name}</span>
                  </Stack>
                ) : (
                  ""
                ),
            }}
          >
            {sortedModels.some(suggested) && <ListSubheader>Suggested</ListSubheader>}
            {sortedModels.filter(suggested).map((m) => (
              <MenuItem key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>
                <ModelOptionRow model={m} />
              </MenuItem>
            ))}
            {sortedModels.some(suggested) && <ListSubheader>All models</ListSubheader>}
            {sortedModels.filter((m) => !suggested(m)).map((m) => (
              <MenuItem key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>
                <ModelOptionRow model={m} />
              </MenuItem>
            ))}
          </TextField>

          {model && (
            <TextField
              select
              size="small"
              label={model.kind === "hierarchy" ? "Node type" : "Element type"}
              value={typeId}
              onChange={(event) => {
                setTypeId(event.target.value);
                setInstance(null);
              }}
              helperText="Optional — narrows the list to one type."
            >
              <MenuItem value="">All types</MenuItem>
              {(types.data ?? []).map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          {model && (
            <Autocomplete
              size="small"
              options={options}
              loading={instances.isLoading}
              value={instance}
              onChange={(_, value) => {
                setInstance(value);
                setNeedsConfirm(null);
              }}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(option) => option.name}
              groupBy={typeId ? undefined : (option) => option.typeName || "Other"}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
                    <span style={{ flex: 1 }}>{option.name}</span>
                    {option.status !== "active" && (
                      <Chip size="small" variant="outlined" label={lifecycleLabel(option.status)} sx={{ height: 18, fontSize: 10 }} />
                    )}
                  </Stack>
                </li>
              )}
              noOptionsText={instances.isLoading ? "Loading…" : "No applications in this model (Archived ones are not offered)."}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Application"
                  placeholder="Search applications"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {instances.isLoading ? <CircularProgress size={14} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          )}

          {model && instance && (
            <Alert severity="info" icon={<AppsOutlinedIcon fontSize="small" />} sx={{ py: 0.25 }}>
              <b>{instance.name}</b> → <b>{tableName}</b>
            </Alert>
          )}

          {current && hasDependents && !needsConfirm && (
            <Typography variant="caption" color="text.secondary">
              This table already has {describe(mappings, quality_findings)} recorded while its source was{" "}
              <b>{current.instance_name ?? "a deleted application"}</b>. Changing it will ask you to confirm.
            </Typography>
          )}

          {needsConfirm && (
            <Alert severity="warning">
              {needsConfirm} The {describe(mappings, quality_findings)} stay as they are; only the recorded source changes, and the change is
              written to the session's audit trail.
            </Alert>
          )}

          {failure && <Alert severity="error">{failure.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {current && (
          <Button
            color="error"
            onClick={() => clear.mutate(pendingClear)}
            disabled={busy}
            sx={{ mr: "auto", textTransform: "none" }}
          >
            {pendingClear ? "Clear anyway" : "Clear"}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={needsConfirm && !pendingClear ? "warning" : "primary"}
          onClick={() => save.mutate(Boolean(needsConfirm) && !pendingClear)}
          disabled={busy || !model || !instance || unchanged}
          startIcon={save.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ textTransform: "none" }}
        >
          {needsConfirm && !pendingClear ? "Change anyway" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ModelOptionRow({ model }: { model: ModelOption }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
      <ModelKindIcon kind={model.kind} size={20} />
      <span style={{ flex: 1 }}>{model.name}</span>
      {model.status !== "active" && <Chip size="small" variant="outlined" label={lifecycleLabel(model.status)} sx={{ height: 18, fontSize: 10 }} />}
    </Stack>
  );
}

function describe(mappings: number, findings: number) {
  const parts: string[] = [];
  if (mappings) parts.push(`${mappings} column mapping${mappings === 1 ? "" : "s"}`);
  if (findings) parts.push(`${findings} quality finding${findings === 1 ? "" : "s"}`);
  return parts.join(" and ") || "records";
}
