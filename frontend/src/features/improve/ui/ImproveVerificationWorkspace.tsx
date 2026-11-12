import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
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
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import {
  useCreateVerification,
  useImproveCandidates,
  useImproveTasks,
  useImproveVerifications
} from "@/features/improve/state/useImproveWorkspace";
import { useAccountabilityParties } from "@/features/accountability/state/useAccountabilityWorkspace";

const OUTCOMES = ["pending", "passed", "failed"] as const;

export function ImproveVerificationWorkspace() {
  const candidatesQuery = useImproveCandidates();
  const tasksQuery = useImproveTasks();
  const verificationsQuery = useImproveVerifications();
  const partiesQuery = useAccountabilityParties();
  const createVerification = useCreateVerification();

  const [candidateId, setCandidateId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [verifiedByPartyId, setVerifiedByPartyId] = useState("");
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("pending");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");

  const candidateTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => !candidateId || task.candidate_id === candidateId),
    [tasksQuery.data, candidateId]
  );

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Verification"
      description="Record verification evidence separately from task progress so closure is evidence-backed and historically visible."
      status="Increment 10"
    >
      <Stack spacing={3}>
        {candidatesQuery.error instanceof Error ? <Alert severity="error">{candidatesQuery.error.message}</Alert> : null}
        {verificationsQuery.error instanceof Error ? <Alert severity="error">{verificationsQuery.error.message}</Alert> : null}
        {createVerification.error instanceof Error ? <Alert severity="error">{createVerification.error.message}</Alert> : null}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Record verification evidence
                </Typography>
                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="verification-candidate-label">Candidate</InputLabel>
                    <Select
                      labelId="verification-candidate-label"
                      label="Candidate"
                      value={candidateId}
                      onChange={(event) => {
                        setCandidateId(event.target.value);
                        setTaskId("");
                      }}
                    >
                      {(candidatesQuery.data ?? []).map((candidate) => (
                        <MenuItem key={candidate.candidate_id} value={candidate.candidate_id}>
                          {candidate.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth size="small">
                    <InputLabel id="verification-task-label">Task</InputLabel>
                    <Select
                      labelId="verification-task-label"
                      label="Task"
                      value={taskId}
                      onChange={(event) => setTaskId(event.target.value)}
                    >
                      <MenuItem value="">No linked task</MenuItem>
                      {candidateTasks.map((task) => (
                        <MenuItem key={task.task_id} value={task.task_id}>
                          {task.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth size="small">
                    <InputLabel id="verification-party-label">Verified by</InputLabel>
                    <Select
                      labelId="verification-party-label"
                      label="Verified by"
                      value={verifiedByPartyId}
                      onChange={(event) => setVerifiedByPartyId(event.target.value)}
                    >
                      <MenuItem value="">Unspecified</MenuItem>
                      {(partiesQuery.data ?? []).map((party) => (
                        <MenuItem key={party.party_id} value={party.party_id}>
                          {party.display_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth size="small">
                    <InputLabel id="verification-outcome-label">Outcome</InputLabel>
                    <Select
                      labelId="verification-outcome-label"
                      label="Outcome"
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value as (typeof OUTCOMES)[number])}
                    >
                      {OUTCOMES.map((item) => (
                        <MenuItem key={item} value={item}>
                          {item}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label="Evidence note"
                    multiline
                    minRows={4}
                    value={evidenceNote}
                    onChange={(event) => setEvidenceNote(event.target.value)}
                  />

                  <Stack direction="row" spacing={1} alignItems="center">
                    <Checkbox
                      checked={followUpRequired}
                      onChange={(event) => setFollowUpRequired(event.target.checked)}
                    />
                    <Typography variant="body2">Follow-up required</Typography>
                  </Stack>

                  <Button
                    variant="contained"
                    disabled={!candidateId || !evidenceNote.trim() || createVerification.isPending}
                    onClick={() =>
                      createVerification.mutate({
                        candidate_id: candidateId,
                        task_id: taskId || undefined,
                        outcome,
                        evidence_note: evidenceNote,
                        follow_up_required: followUpRequired,
                        verified_by_party_id: verifiedByPartyId || undefined
                      })
                    }
                  >
                    Save verification
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 7 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Verification evidence log
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Candidate</TableCell>
                      <TableCell>Task</TableCell>
                      <TableCell>Outcome</TableCell>
                      <TableCell>Verified by</TableCell>
                      <TableCell>Follow-up</TableCell>
                      <TableCell>Evidence</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(verificationsQuery.data ?? []).map((verification) => (
                      <TableRow key={verification.verification_id} hover>
                        <TableCell>{verification.candidate_title ?? verification.candidate_id}</TableCell>
                        <TableCell>{verification.task_title ?? "—"}</TableCell>
                        <TableCell>{verification.outcome}</TableCell>
                        <TableCell>{verification.verified_by_name ?? verification.verified_by_party_id ?? "—"}</TableCell>
                        <TableCell>{verification.follow_up_required ? "Yes" : "No"}</TableCell>
                        <TableCell>
                          <Typography variant="body2">{verification.evidence_note}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(verification.verified_at).toLocaleString()}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Stack>
    </WorkspacePageTemplate>
  );
}
