import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { Alert, Button, Card, CardContent, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useOrganisationSettings, useUpdateOrganisationSetting } from "@/features/settings/state/useSettingsWorkspace";
import { PACKAGES_SETTING_KEY } from "@/shared/workspace/modelPackages";

const MANAGED_ELSEWHERE = new Set([PACKAGES_SETTING_KEY]);

export function SettingsOrganisationWorkspace() {
  const settingsQuery = useOrganisationSettings();
  const updateMutation = useUpdateOrganisationSetting();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Settings a workspace keeps for itself (e.g. Model Workspace packages) are managed there, not here.
  const items = useMemo(() => (settingsQuery.data ?? []).filter((item) => !MANAGED_ELSEWHERE.has(item.setting_key)), [settingsQuery.data]);

  return (
    <WorkspacePageTemplate
      workspace="Settings"
      pageTitle="Organisation"
      description="Manage organisation-level defaults used by the trial application shell and seeded operational flows."
      status="Increment 12"
    >
      <Stack spacing={3}>
        {updateMutation.error instanceof Error ? <Alert severity="error">{updateMutation.error.message}</Alert> : null}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>Organisation defaults</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Setting</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const value = drafts[item.setting_key] ?? item.setting_value;
                  return (
                    <TableRow key={item.setting_key}>
                      <TableCell>{item.setting_key}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={value}
                          onChange={(event) => setDrafts((previous) => ({ ...previous, [item.setting_key]: event.target.value }))}
                        />
                      </TableCell>
                      <TableCell>{new Date(item.updated_at).toLocaleString()}</TableCell>
                      <TableCell align="right">
                        <Button
                          variant="contained"
                          startIcon={<SaveOutlinedIcon />}
                          onClick={() => updateMutation.mutate({ settingKey: item.setting_key, settingValue: value, actorLabel: "Settings workspace" })}
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
