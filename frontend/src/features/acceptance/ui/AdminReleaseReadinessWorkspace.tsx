import { Alert, Chip, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { useAcceptanceWorkspace } from "@/features/acceptance/state/useAcceptanceWorkspace";

function statusColor(status: string): "success" | "warning" | "error" | "default" {
  switch (status) {
    case "ready":
    case "passed":
    case "covered":
      return "success";
    case "partial":
    case "warning":
      return "warning";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "default";
  }
}

export function AdminReleaseReadinessWorkspace() {
  const { releaseReadiness, isLoading } = useAcceptanceWorkspace();

  if (isLoading || !releaseReadiness) {
    return <Typography>Loading release readiness…</Typography>;
  }

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        This view consolidates the governed release-candidate checks so a reviewer can decide whether the seeded PDP trial is ready to hand over.
      </Alert>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
        <Typography variant="h5">{releaseReadiness.release_label}</Typography>
        <Chip label={releaseReadiness.overall_status} color={statusColor(releaseReadiness.overall_status)} size="small" />
      </Stack>

      <Typography color="text.secondary">
        Generated {releaseReadiness.generated_at} · Covered routes {releaseReadiness.covered_route_count}/{releaseReadiness.total_route_count} · Ready scenarios {releaseReadiness.scenario_ready_count}/{releaseReadiness.scenario_total_count} · Diagnostics {releaseReadiness.diagnostics_status}
      </Typography>

      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <Stack spacing={1} sx={{ flex: 1 }}>
          <Typography variant="h6">Checklist</Typography>
          <List>
            {releaseReadiness.checklist.map((item) => (
              <ListItem key={item.item_code} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography>{item.title}</Typography>
                      <Chip label={item.status} color={statusColor(item.status)} size="small" />
                    </Stack>
                  }
                  secondary={`${item.detail}${item.related_route ? ` · Route: ${item.related_route}` : ""}`}
                />
              </ListItem>
            ))}
          </List>
        </Stack>

        <Stack spacing={1} sx={{ flex: 1 }}>
          <Typography variant="h6">Scenario summaries</Typography>
          <List>
            {releaseReadiness.scenario_summaries.map((item) => (
              <ListItem key={item.scenario_code} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography>{item.title}</Typography>
                      <Chip label={item.status} color={statusColor(item.status)} size="small" />
                    </Stack>
                  }
                  secondary={`Evidence ${item.evidence_count} · Routes: ${item.key_routes.join(", ")}`}
                />
              </ListItem>
            ))}
          </List>
        </Stack>
      </Stack>
    </Stack>
  );
}
