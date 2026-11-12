import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { Alert, Button, Card, CardContent, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useUpdateUserPreference, useUserPreferences } from "@/features/settings/state/useSettingsWorkspace";

export function SettingsPreferencesWorkspace() {
  const preferencesQuery = useUserPreferences();
  const updateMutation = useUpdateUserPreference();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const items = useMemo(() => preferencesQuery.data ?? [], [preferencesQuery.data]);

  return (
    <WorkspacePageTemplate
      workspace="Settings"
      pageTitle="Preferences"
      description="Manage user-facing preferences and reference values used across seeded trial workspaces."
      status="Increment 12"
    >
      <Stack spacing={3}>
        {updateMutation.error instanceof Error ? <Alert severity="error">{updateMutation.error.message}</Alert> : null}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>Preferences and defaults</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Preference</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const value = drafts[item.preference_key] ?? item.preference_value;
                  return (
                    <TableRow key={item.preference_key}>
                      <TableCell>{item.preference_key}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={value}
                          onChange={(event) => setDrafts((previous) => ({ ...previous, [item.preference_key]: event.target.value }))}
                        />
                      </TableCell>
                      <TableCell>{new Date(item.updated_at).toLocaleString()}</TableCell>
                      <TableCell align="right">
                        <Button
                          variant="contained"
                          startIcon={<TuneOutlinedIcon />}
                          onClick={() => updateMutation.mutate({ preferenceKey: item.preference_key, preferenceValue: value, actorLabel: "Settings workspace" })}
                        >
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
