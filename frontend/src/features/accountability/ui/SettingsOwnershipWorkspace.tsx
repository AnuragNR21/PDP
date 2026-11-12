import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { Alert, Button, Card, CardContent, FormControl, Grid, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useAccountabilityAssignments, useAccountabilityParties, useCreateAccountabilityAssignment } from "@/features/accountability/state/useAccountabilityWorkspace";

const DEFAULT_SCOPE_TYPE = "candidate";
const DEFAULT_SCOPE_ID = "candidate_seed_1";
const ROLE_OPTIONS = ["owner", "steward", "analyst", "assignee", "reviewer"] as const;

export function SettingsOwnershipWorkspace() {
  const partiesQuery = useAccountabilityParties();
  const assignmentsQuery = useAccountabilityAssignments();
  const createAssignment = useCreateAccountabilityAssignment();
  const [scopeType, setScopeType] = useState(DEFAULT_SCOPE_TYPE);
  const [scopeId, setScopeId] = useState(DEFAULT_SCOPE_ID);
  const [roleCode, setRoleCode] = useState("owner");
  const [partyId, setPartyId] = useState("party_manager");

  const grouped = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);

  return (
    <WorkspacePageTemplate
      workspace="Settings"
      pageTitle="Ownership Registry"
      description="Maintain typed accountability assignments across canonical nodes, discovery evidence, improvement candidates, and tasks."
      status="Increment 9"
    >
      <Stack spacing={3}>
        {createAssignment.error instanceof Error ? <Alert severity="error">{createAssignment.error.message}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Create assignment
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel id="scope-type-label">Scope type</InputLabel>
                  <Select labelId="scope-type-label" label="Scope type" value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
                    <MenuItem value="node">node</MenuItem>
                    <MenuItem value="check_result">check_result</MenuItem>
                    <MenuItem value="candidate">candidate</MenuItem>
                    <MenuItem value="task">task</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel id="scope-id-label">Scope id</InputLabel>
                  <Select labelId="scope-id-label" label="Scope id" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
                    <MenuItem value="node_account_status">node_account_status</MenuItem>
                    <MenuItem value="res_seed_1">res_seed_1</MenuItem>
                    <MenuItem value="candidate_seed_1">candidate_seed_1</MenuItem>
                    <MenuItem value="task_seed_1">task_seed_1</MenuItem>
                    <MenuItem value="task_seed_2">task_seed_2</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="role-code-label">Role</InputLabel>
                  <Select labelId="role-code-label" label="Role" value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
                    {ROLE_OPTIONS.map((role) => (
                      <MenuItem key={role} value={role}>{role}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="party-id-label">Party</InputLabel>
                  <Select labelId="party-id-label" label="Party" value={partyId} onChange={(event) => setPartyId(event.target.value)}>
                    {(partiesQuery.data ?? []).map((party) => (
                      <MenuItem key={party.party_id} value={party.party_id}>{party.display_name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <Button fullWidth variant="contained" startIcon={<PersonAddAltOutlinedIcon />} sx={{ height: "100%" }} onClick={() => createAssignment.mutate({ scope_type: scopeType, scope_id: scopeId, role_code: roleCode, party_id: partyId })}>
                  Assign
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>Active typed assignments</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Scope</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Party</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Assigned</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {grouped.map((assignment) => (
                  <TableRow key={assignment.assignment_id}>
                    <TableCell>{assignment.scope_type} · {assignment.scope_id}</TableCell>
                    <TableCell>{assignment.role_code}</TableCell>
                    <TableCell>{assignment.party_name}</TableCell>
                    <TableCell>{assignment.party_email}</TableCell>
                    <TableCell>{new Date(assignment.assigned_at).toLocaleString()}</TableCell>
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
