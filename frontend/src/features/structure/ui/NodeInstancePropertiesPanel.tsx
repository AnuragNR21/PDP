import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { OverflowText } from "@/shared/workspace/OverflowText";
import { EditAction } from "@/shared/workspace/WorkspaceIcons";
import type { EffectiveProperty } from "../api/structureApi";
import { useSetNodeInstancePropertyValue } from "../state/useStructureWorkspace";
import { ACTIVE, ARCHIVED, lifecycleLabel } from "./workspace/lifecycle";

const MAX_VALUE = 4000;

/** Why a property's value cannot be edited here, or null when it can. */
export function propertyValueLock(property: EffectiveProperty, instanceStatus: string): string | null {
  if (property.property_status !== ACTIVE) {
    return `${lifecycleLabel(property.property_status)} on its Node Type — activate it in the Model Workspace before giving it a value.`;
  }
  if (instanceStatus === ARCHIVED) return "This instance is Archived, so its property values cannot be changed.";
  return null;
}

/**
 * SWS · Node Instance › Properties.
 *
 * The Properties are the ones its Node Type defines in MWS — on the type
 * itself, or inherited from an ancestor type — shown the way MWS lists them
 * (one row per property, its status as a chip), with what SWS adds: this
 * instance's value. Nothing here creates, renames or redefines a property;
 * ✎ edits the value only, and only while the definition is Active and the
 * instance is not Archived.
 */
export function NodeInstancePropertiesPanel(props: {
  nodeInstanceId: string;
  instanceStatus: string;
  nodeTypeName: string;
  properties: EffectiveProperty[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Where the Node Type is defined, to say where a property is changed. */
  modelWorkspaceUrl: string | null;
}) {
  const setValue = useSetNodeInstancePropertyValue(props.nodeInstanceId);
  const [editing, setEditing] = useState<EffectiveProperty | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (property: EffectiveProperty) => {
    setEditing(property);
    setDraft(property.value ?? "");
    setError(null);
  };
  const save = async (value: string) => {
    if (!editing) return;
    setError(null);
    try {
      await setValue.mutateAsync({ propertyId: editing.property_id, value });
      setEditing(null);
    } catch (err) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save the value.");
    }
  };

  const properties = props.properties ?? [];
  const withValue = properties.filter((p) => p.value).length;

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          Properties ({properties.length}){properties.length > 0 ? ` · ${withValue} with a value` : ""}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Defined on the Node Type in the Model Workspace; each instance gives them its own value.
      </Typography>

      {props.isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}><CircularProgress size={20} /></Box>
      ) : props.isError ? (
        <Alert severity="error" sx={{ py: 0 }}>Could not load properties.</Alert>
      ) : properties.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, px: 1.5, py: 2, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Node type “{props.nodeTypeName}” defines no properties. Add them to the Node Type in the Model Workspace.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.75}>
          {properties.map((property) => {
            const lock = propertyValueLock(property, props.instanceStatus);
            const definedBy = property.source_node_type_name ?? property.inherited_from ?? props.nodeTypeName;
            return (
              <Stack
                key={property.property_id}
                direction="row"
                spacing={1}
                alignItems="flex-start"
                data-property-id={property.property_id}
                sx={{ px: 1.25, py: 0.75, border: 1, borderColor: "divider", borderRadius: 1, "&:hover": { bgcolor: "action.hover" }, opacity: lock && property.property_status !== ACTIVE ? 0.75 : 1 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <OverflowText variant="body2" fontWeight={600}>{property.property_name}</OverflowText>
                  {property.property_description && (
                    <OverflowText variant="caption" color="text.secondary" display="block">{property.property_description}</OverflowText>
                  )}
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                    <Tooltip title={property.origin === "inherited" ? `Inherited from the ancestor Node Type “${definedBy}”.` : `Defined on this instance's Node Type, “${definedBy}”.`}>
                      <Chip size="small" variant="outlined" color="info" label={`Defined by: ${definedBy}`} sx={{ height: 20, fontSize: 11 }} />
                    </Tooltip>
                    {property.origin === "inherited" && <Chip size="small" variant="outlined" label="Inherited" sx={{ height: 20, fontSize: 11 }} />}
                    <Chip
                      size="small"
                      variant="outlined"
                      color={property.property_status === ACTIVE ? "success" : property.property_status === ARCHIVED ? "default" : "warning"}
                      label={lifecycleLabel(property.property_status)}
                      sx={{ height: 20, fontSize: 11, ...(property.property_status === ARCHIVED ? { borderStyle: "dashed" } : {}) }}
                    />
                  </Stack>
                  <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mt: 0.75, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Value</Typography>
                    {property.value ? (
                      <OverflowText variant="body2" sx={{ fontWeight: 500 }}>{property.value}</OverflowText>
                    ) : (
                      <Typography variant="body2" color="text.disabled" sx={{ fontStyle: "italic" }}>Not set</Typography>
                    )}
                  </Stack>
                </Box>
                <Tooltip title={lock ?? ""}>
                  <span>
                    <EditAction label={`${property.property_name} value`} onClick={() => open(property)} disabled={Boolean(lock)} />
                  </span>
                </Tooltip>
              </Stack>
            );
          })}
        </Stack>
      )}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Property value</DialogTitle>
        <DialogContent>
          {editing && (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              {/* The definition, read-only: it is changed in the Model Workspace. */}
              <TextField size="small" fullWidth label="Property" value={editing.property_name} InputProps={{ readOnly: true }} sx={{ "& .MuiInputBase-root": { bgcolor: "action.hover" } }} />
              <TextField
                size="small"
                fullWidth
                label="Defined by"
                value={`${editing.source_node_type_name ?? props.nodeTypeName}${editing.origin === "inherited" ? " (inherited)" : ""}`}
                InputProps={{ readOnly: true }}
                helperText={props.modelWorkspaceUrl ? "The property itself is defined in the Model Workspace." : undefined}
                sx={{ "& .MuiInputBase-root": { bgcolor: "action.hover" } }}
              />
              <TextField
                autoFocus
                fullWidth
                multiline
                minRows={2}
                label="Value"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                error={draft.length > MAX_VALUE}
                helperText={draft.length > MAX_VALUE ? `At most ${MAX_VALUE} characters.` : "This instance's value. Leave empty to clear it."}
              />
              {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {editing?.value && (
            <Button color="error" onClick={() => void save("")} disabled={setValue.isPending} sx={{ mr: "auto" }}>
              Clear value
            </Button>
          )}
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void save(draft)}
            disabled={setValue.isPending || draft.length > MAX_VALUE || draft.trim() === (editing?.value ?? "")}
          >
            {setValue.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
