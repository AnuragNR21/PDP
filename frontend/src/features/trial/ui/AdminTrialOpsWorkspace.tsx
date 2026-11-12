import CachedOutlinedIcon from "@mui/icons-material/CachedOutlined";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import {
  Alert,
  Button,
  List,
  ListItem,
  ListItemText,
  Stack
} from "@mui/material";
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";

import {
  useTrialReset,
  useTrialReseed,
  useTrialSummary
} from "@/features/trial/state/useTrialWorkspace";

export function AdminTrialOpsWorkspace() {
  const summaryQuery = useTrialSummary();
  const resetMutation = useTrialReset();
  const reseedMutation = useTrialReseed();
  const summary = summaryQuery.data;

  return (
    <WorkspacePage
      icon={<ScienceOutlined />}
      workspace="Admin"
      pageTitle="Trial Operations"
      description="Low-friction reset, reseed, and trial telemetry summary for reliable demos and evaluation."
      status="Increment 7"
      counts={[
        { label: "Events", value: summary?.total_events ?? 0 },
        { label: "Feedback", value: summary?.total_feedback ?? 0, hint: "Feedback items" },
        { label: "Follow-up types", value: Object.keys(summary?.next_step_counts ?? {}).length },
      ]}
      actions={
        <>
          <Button size="small" variant="contained" startIcon={<RestartAltOutlinedIcon />} onClick={() => resetMutation.mutate()}>
            Reset
          </Button>
          <Button size="small" variant="outlined" startIcon={<CachedOutlinedIcon />} onClick={() => reseedMutation.mutate()}>
            Reseed
          </Button>
        </>
      }
    >
      <Stack spacing={1}>
        {summaryQuery.error instanceof Error ? <Alert severity="error">{summaryQuery.error.message}</Alert> : null}

        <SectionPanel title="Top scenarios" flush>
            <List dense sx={{ px: 1.5 }}>
              {(summary?.top_scenarios ?? []).length === 0 && (
                <ListItem disablePadding>
                  <ListItemText secondary={summaryQuery.isLoading ? "Loading…" : "No scenarios recorded yet."} />
                </ListItem>
              )}
              {(summary?.top_scenarios ?? []).map((item) => (
                <ListItem key={item.scenario_code} disablePadding>
                  <ListItemText primary={item.scenario_code} secondary={`Events: ${item.count}`} />
                </ListItem>
              ))}
            </List>
          </SectionPanel>
      </Stack>
    </WorkspacePage>
  );
}
