import AddTaskOutlinedIcon from "@mui/icons-material/AddTaskOutlined";
import {
  Alert,
  Box,
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
  TextField,
  Typography
} from "@mui/material";
import { useMemo, useState } from "react";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useAccountabilityParties } from "@/features/accountability/state/useAccountabilityWorkspace";
import { useCreateWorkProgram, useImproveCandidates, useImproveWorkPrograms } from "@/features/improve/state/useImproveWorkspace";

export function ImproveWorkProgramWorkspace() {
  const candidatesQuery = useImproveCandidates();
  const programsQuery = useImproveWorkPrograms();
  const createProgram = useCreateWorkProgram();
  const partiesQuery = useAccountabilityParties();

  const [name, setName] = useState("Focused remediation program");
  const [ownerName, setOwnerName] = useState("Data Steward");
  const [ownerPartyId, setOwnerPartyId] = useState("party_steward");
  const [priority, setPriority] = useState("medium");

  const openCandidates = useMemo(
    () => (candidatesQuery.data ?? []).filter((candidate) => candidate.status !== "closed"),
    [candidatesQuery.data]
  );

  const defaultCandidateIds = openCandidates.slice(0, 2).map((candidate) => candidate.candidate_id);

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Work Program"
      description="Create governed remediation programs from Improve candidates and maintain clear ownership."
      status="Increment 6"
    >
      <Stack spacing={3}>
        {createProgram.error instanceof Error ? <Alert severity="error">{createProgram.error.message}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Create work program
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField fullWidth label="Program name" value={name} onChange={(event) => setName(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <TextField fullWidth label="Owner label" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="owner-party-label">Owner party</InputLabel>
                  <Select labelId="owner-party-label" label="Owner party" value={ownerPartyId} onChange={(event) => setOwnerPartyId(event.target.value)}>
                    {(partiesQuery.data ?? []).map((party) => (
                      <MenuItem key={party.party_id} value={party.party_id}>{party.display_name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel id="priority-label">Priority</InputLabel>
                  <Select
                    labelId="priority-label"
                    label="Priority"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    <MenuItem value="low">low</MenuItem>
                    <MenuItem value="medium">medium</MenuItem>
                    <MenuItem value="high">high</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <Button
                  fullWidth
                  startIcon={<AddTaskOutlinedIcon />}
                  sx={{ height: "100%" }}
                  variant="contained"
                  disabled={defaultCandidateIds.length === 0 || createProgram.isPending}
                  onClick={() =>
                    createProgram.mutate({
                      name,
                      owner_name: ownerName,
                      owner_party_id: ownerPartyId,
                      priority,
                      candidate_ids: defaultCandidateIds
                    })
                  }
                >
                  Create
                </Button>
              </Grid>
            </Grid>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                This increment creates a focused work program from the first open Improve candidates to keep the workflow concrete and governed.
              </Typography>
            </Box>
          </CardContent>
        </Card>

        <Grid container spacing={2}>
          {(programsQuery.data ?? []).map((program) => (
            <Grid key={program.program_id} size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: 1 }}>
                    <Typography variant="h6">{program.name}</Typography>
                    <Chip label={`${program.priority} · ${program.status}`} size="small" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Owner: {program.owner_name}{program.owner_party_id ? ` · ${program.owner_party_id}` : ""}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Targets: {program.target_count} · Open tasks: {program.open_task_count}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(program.created_at).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Stack>
    </WorkspacePageTemplate>
  );
}
