import { useEffect, useState } from "react";
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
  Divider,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { modelDefinitionsApi } from "../../api/modelDefinitionsApi";
import type { InstanceParentAssignment } from "../../domain/types";

export interface ReparentNodeInfo {
  nodeId: string;
  nodeName: string;
  oldParentName: string;
  newParentNodeId: string;
  newParentName: string;
  position: number;
}

function HierarchyPreviewColumn({ parentLabel, nodeName }: { parentLabel: string; nodeName: string }) {
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled', flexShrink: 0 }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>{parentLabel}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pl: 2 }}>
        <Box sx={{ width: 2, height: 16, bgcolor: 'text.disabled', flexShrink: 0, borderRadius: 1 }} />
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
        <Typography variant="body2" fontWeight={600}>{nodeName}</Typography>
      </Stack>
    </Stack>
  );
}

export function ReparentNodeDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: ReparentNodeInfo | null;
  onConfirm: (info: ReparentNodeInfo, assignments: InstanceParentAssignment[]) => void;
  onCancel: () => void;
}) {
  const impactQuery = useQuery({
    queryKey: ["reparent-impact", pending?.nodeId, pending?.newParentNodeId],
    queryFn: () => modelDefinitionsApi.getHierarchyNodeTypeReparentImpact(pending!.nodeId, pending!.newParentNodeId),
    enabled: Boolean(pending),
  });
  const impact = impactQuery.data;

  // Per-instance chosen parent (id, or null for "become a root"). Seeded from defaults.
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!impact) return;
    const seed: Record<string, string | null> = {};
    impact.planItems.forEach((item) => { seed[item.instanceId] = item.defaultParentInstanceId; });
    setAssignments(seed);
  }, [impact]);

  const affected = impact?.affectedInstanceCount ?? 0;
  const isRoot = impact?.newParentIsRoot ?? false;
  // Every affected instance must have a chosen parent (or be a root move) before confirming.
  const allAssigned = !impact || affected === 0 || isRoot
    || impact.planItems.every((item) => item.resolvable && assignments[item.instanceId] != null);
  const confirmDisabled = impactQuery.isLoading || Boolean(impactQuery.error)
    || (affected > 0 && (!impact?.resolvable || !allAssigned));

  function handleConfirm() {
    if (!pending || !impact) return;
    const list: InstanceParentAssignment[] = impact.planItems.map((item) => ({
      instanceId: item.instanceId,
      newParentInstanceId: isRoot ? null : assignments[item.instanceId] ?? null,
    }));
    onConfirm(pending, list);
  }

  return (
    <Dialog open={!!pending} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Change Node Level?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Moving <strong>{pending?.nodeName}</strong> will change its depth level and its structural rules.
        </Typography>

        <Stack direction="row" spacing={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <Paper elevation={0} sx={{ flex: 1, p: 2, bgcolor: 'grey.50' }}>
            <Typography variant="overline" color="text.secondary" display="block" sx={{ mb: 1, lineHeight: 1.2 }}>Before</Typography>
            <HierarchyPreviewColumn parentLabel={pending?.oldParentName ?? ''} nodeName={pending?.nodeName ?? ''} />
          </Paper>
          <Divider orientation="vertical" flexItem />
          <Paper elevation={0} sx={{ flex: 1, p: 2, bgcolor: 'primary.50' }}>
            <Typography variant="overline" color="primary" display="block" sx={{ mb: 1, lineHeight: 1.2 }}>After</Typography>
            <HierarchyPreviewColumn parentLabel={pending?.newParentName ?? ''} nodeName={pending?.nodeName ?? ''} />
          </Paper>
        </Stack>

        {/* ── Structure Workspace impact ─────────────────────────────────── */}
        <Box sx={{ mt: 2 }}>
          {impactQuery.isLoading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Assessing Structure Workspace impact…</Typography>
            </Stack>
          )}

          {impactQuery.error && <Alert severity="warning">Could not assess the Structure Workspace impact. Try again.</Alert>}

          {impact && affected === 0 && (
            <Alert severity="success">No existing Structure Workspace node instances are affected.</Alert>
          )}

          {impact && affected > 0 && (
            <Stack spacing={1.25}>
              {isRoot ? (
                <Alert severity="warning">
                  {impact.affectedInstanceCount} affected node instance{impact.affectedInstanceCount !== 1 ? 's' : ''} will
                  become root instances. Existing instance IDs and relationships are preserved.
                </Alert>
              ) : (
                <>
                  <Alert severity={impact.resolvable ? "warning" : "error"}>
                    {impact.resolvable
                      ? "Select the new parent instance for each affected instance below. Deterministic matches are pre-selected; instance IDs and relationships are preserved."
                      : "Some affected instances have no candidate parent of the new type. Resolve them first (for example via Structure Workspace Import/Export), then retry."}
                  </Alert>

                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Affected instance</TableCell>
                          <TableCell>
                            Old parent instance
                            {pending?.oldParentName && pending.oldParentName !== 'Root Level' && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 400 }}>
                                Parent old type: {pending.oldParentName}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            New parent instance
                            {pending?.newParentName && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 400 }}>
                                Parent new type: {pending.newParentName}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {impact.planItems.map((item) => (
                          <TableRow key={item.instanceId} hover>
                            <TableCell sx={{ maxWidth: 280 }}>
                              <Tooltip title={item.instancePath}>
                                <Box>
                                  <Typography variant="body2" noWrap>{item.instanceName}</Typography>
                                  <Typography variant="caption" color="text.secondary" noWrap display="block">{item.instancePath}</Typography>
                                </Box>
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 220 }}>
                              {item.oldParentInstanceName ? (
                                <Typography variant="body2" noWrap>{item.oldParentInstanceName}</Typography>
                              ) : (
                                <Typography variant="body2" color="text.secondary">(root)</Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.resolvable ? (
                                <FormControl size="small" fullWidth>
                                  <Select
                                    value={assignments[item.instanceId] ?? ""}
                                    displayEmpty
                                    onChange={(e) => setAssignments((prev) => ({ ...prev, [item.instanceId]: e.target.value || null }))}
                                  >
                                    <MenuItem value=""><em>Select parent…</em></MenuItem>
                                    {item.candidateParents.map((c) => (
                                      <MenuItem key={c.instanceId} value={c.instanceId}>
                                        <Tooltip title={c.instancePath} placement="right">
                                          <span>{c.instanceName}</span>
                                        </Tooltip>
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              ) : (
                                <Chip size="small" color="error" variant="outlined" label="No candidate parent" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          color={affected > 0 ? 'warning' : 'primary'}
          disabled={confirmDisabled}
          onClick={handleConfirm}
        >
          Confirm Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
