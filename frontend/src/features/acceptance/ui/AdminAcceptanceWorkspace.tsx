import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
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

export function AdminAcceptanceWorkspace() {
  const {
    actorLabel,
    setActorLabel,
    selectedScenarioCodes,
    toggleScenario,
    scenarios,
    routes,
    releaseReadiness,
    routeCoverage,
    isLoading,
    runHarness,
    runSummary,
    isRunning
  } = useAcceptanceWorkspace();

  if (isLoading) {
    return <Typography>Loading acceptance evidence…</Typography>;
  }

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        Acceptance evidence reads seeded platform state only. It does not create new authority outside the governed route set.
      </Alert>

      {releaseReadiness ? (
        <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">Release-candidate readiness</Typography>
                <Chip label={releaseReadiness.overall_status} color={statusColor(releaseReadiness.overall_status)} size="small" />
              </Stack>
              <Typography color="text.secondary">
                {releaseReadiness.release_label} · Generated {releaseReadiness.generated_at}
              </Typography>
            </Box>
            <Typography color="text.secondary">
              Routes {releaseReadiness.covered_route_count}/{releaseReadiness.total_route_count} · Scenarios {releaseReadiness.scenario_ready_count}/{releaseReadiness.scenario_total_count}
            </Typography>
          </Stack>
        </Box>
      ) : null}

      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Scenario catalogue
          </Typography>
          <List>
            {scenarios.map((scenario) => (
              <ListItem
                key={scenario.scenario_code}
                divider
                secondaryAction={
                  <Checkbox
                    edge="end"
                    checked={selectedScenarioCodes.includes(scenario.scenario_code)}
                    onChange={() => toggleScenario(scenario.scenario_code)}
                  />
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography>{scenario.title}</Typography>
                      <Chip label={scenario.status} color={statusColor(scenario.status)} size="small" />
                    </Stack>
                  }
                  secondary={`${scenario.description} · Primary route: ${scenario.primary_route} · Evidence: ${scenario.evidence_count}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Route evidence
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Covered routes: {routeCoverage.covered} / {routeCoverage.total}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Route</TableCell>
                <TableCell>Workspace</TableCell>
                <TableCell>Smoke</TableCell>
                <TableCell>Evidence source</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {routes.map((route) => (
                <TableRow key={`${route.route}-${route.evidence_source}`}>
                  <TableCell>{route.route}</TableCell>
                  <TableCell>{route.workspace}</TableCell>
                  <TableCell>
                    <Chip label={route.smoke_status} color={statusColor(route.smoke_status)} size="small" />
                  </TableCell>
                  <TableCell>{route.evidence_source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Stack>

      {releaseReadiness ? (
        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Release checklist
            </Typography>
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
          </Box>

          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Scenario readiness summary
            </Typography>
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
                    secondary={`Evidence: ${item.evidence_count} · Key routes: ${item.key_routes.join(", ")}`}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        </Stack>
      ) : null}

      <Divider />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
        <TextField
          label="Actor label"
          value={actorLabel}
          onChange={(event) => setActorLabel(event.target.value)}
          sx={{ minWidth: 280 }}
        />
        <Button variant="contained" onClick={() => runHarness()} disabled={isRunning}>
          Run acceptance harness
        </Button>
      </Stack>

      {runSummary ? (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6">Harness result</Typography>
            <Chip label={runSummary.overall_status} color={statusColor(runSummary.overall_status)} size="small" />
          </Stack>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Run ID: {runSummary.run_id} · Executed: {runSummary.executed_at}
          </Typography>
          <List>
            {runSummary.results.map((result) => (
              <ListItem key={result.check_code} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography>{result.title}</Typography>
                      <Chip label={result.status} color={statusColor(result.status)} size="small" />
                    </Stack>
                  }
                  secondary={result.detail}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      ) : null}
    </Stack>
  );
}
