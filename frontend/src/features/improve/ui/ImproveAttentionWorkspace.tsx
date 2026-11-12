
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useAccountabilityParties } from "@/features/accountability/state/useAccountabilityWorkspace";
import {
  useImproveAttentionSignals,
  useImproveFollowUpQueue,
  useUpdateFollowUpQueue
} from "@/features/improve/state/useImproveWorkspace";

const QUEUE_STATUSES = ["all", "open", "in_progress", "resolved"] as const;

export function ImproveAttentionWorkspace() {
  const [queueStatus, setQueueStatus] = useState<(typeof QUEUE_STATUSES)[number]>("all");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const signalsQuery = useImproveAttentionSignals();
  const followUpQuery = useImproveFollowUpQueue(queueStatus === "all" ? undefined : queueStatus);
  const updateFollowUp = useUpdateFollowUpQueue();
  const partiesQuery = useAccountabilityParties();

  const partiesById = useMemo(
    () => new Map((partiesQuery.data ?? []).map((party) => [party.party_id, party.display_name])),
    [partiesQuery.data]
  );

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Attention"
      description="Operational alerts, attention signals, and verification follow-up work derived from current remediation evidence."
      status="Increment 11"
    >
      <Stack spacing={3}>
        {signalsQuery.error instanceof Error ? <Alert severity="error">{signalsQuery.error.message}</Alert> : null}
        {followUpQuery.error instanceof Error ? <Alert severity="error">{followUpQuery.error.message}</Alert> : null}
        {updateFollowUp.error instanceof Error ? <Alert severity="error">{updateFollowUp.error.message}</Alert> : null}

        <Grid container spacing={2}>
          {(signalsQuery.data ?? []).map((signal) => (
            <Grid key={signal.signal_id} size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <NotificationsActiveOutlinedIcon />
                    <Stack spacing={1} sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                        <Typography variant="h6">{signal.title}</Typography>
                        <Chip size="small" label={`${signal.severity} · ${signal.related_count}`} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {signal.detail}
                      </Typography>
                      <Button component={RouterLink} to={signal.related_route} size="small" sx={{ alignSelf: "flex-start" }}>
                        Open related workspace
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="h6">Verification follow-up queue</Typography>
              <FormControl sx={{ minWidth: 220 }}>
                <InputLabel id="queue-status-label">Queue status</InputLabel>
                <Select
                  labelId="queue-status-label"
                  label="Queue status"
                  value={queueStatus}
                  onChange={(event) => setQueueStatus(event.target.value as (typeof QUEUE_STATUSES)[number])}
                >
                  {QUEUE_STATUSES.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Candidate</TableCell>
                  <TableCell>Task</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell>Queue status</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Follow-up</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(followUpQuery.data ?? []).map((item) => (
                  <TableRow key={item.verification_id} hover>
                    <TableCell>{item.candidate_title ?? item.candidate_id}</TableCell>
                    <TableCell>{item.task_title ?? "—"}</TableCell>
                    <TableCell>{item.outcome}</TableCell>
                    <TableCell>
                      <FormControl size="small" sx={{ minWidth: 140 }}>
                        <Select
                          value={item.queue_status}
                          onChange={(event) =>
                            updateFollowUp.mutate({
                              verificationId: item.verification_id,
                              queue_status: event.target.value
                            })
                          }
                        >
                          <MenuItem value="open">open</MenuItem>
                          <MenuItem value="in_progress">in_progress</MenuItem>
                          <MenuItem value="resolved">resolved</MenuItem>
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <Select
                          value={item.owner_party_id ?? ""}
                          displayEmpty
                          onChange={(event) =>
                            updateFollowUp.mutate({
                              verificationId: item.verification_id,
                              queue_status: item.queue_status,
                              due_date: item.due_date ?? undefined,
                              owner_party_id: event.target.value || undefined,
                              follow_up_note: noteDraft[item.verification_id] ?? item.follow_up_note ?? undefined
                            })
                          }
                        >
                          <MenuItem value="">Unassigned</MenuItem>
                          {(partiesQuery.data ?? []).map((party) => (
                            <MenuItem key={party.party_id} value={party.party_id}>
                              {party.display_name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>{item.due_date ?? "—"}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {item.follow_up_note ?? item.evidence_note}
                        </Typography>
                        <TextField
                          size="small"
                          placeholder="Update follow-up note"
                          value={noteDraft[item.verification_id] ?? ""}
                          onChange={(event) =>
                            setNoteDraft((current) => ({
                              ...current,
                              [item.verification_id]: event.target.value
                            }))
                          }
                        />
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() =>
                          updateFollowUp.mutate({
                            verificationId: item.verification_id,
                            queue_status: item.queue_status,
                            owner_party_id: item.owner_party_id ?? undefined,
                            due_date: item.due_date ?? undefined,
                            follow_up_note: noteDraft[item.verification_id] ?? item.follow_up_note ?? undefined
                          })
                        }
                      >
                        Save
                      </Button>
                      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                        {item.owner_party_name ?? (item.owner_party_id ? partiesById.get(item.owner_party_id) : "Unassigned")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
