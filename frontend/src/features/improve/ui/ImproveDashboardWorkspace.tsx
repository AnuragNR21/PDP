import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useImproveDashboard } from "@/features/improve/state/useImproveWorkspace";

export function ImproveDashboardWorkspace() {
  const dashboardQuery = useImproveDashboard();
  const navigate = useNavigate();
  const dashboard = dashboardQuery.data;

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Dashboard"
      description="Trend and action visibility derived from Impact handoff, work programs, and remediation progress."
      status="Increment 6"
    >
      <Stack spacing={3}>
        {dashboardQuery.error instanceof Error ? <Alert severity="error">{dashboardQuery.error.message}</Alert> : null}

        <Grid container spacing={2}>
          {(dashboard?.metrics ?? []).map((metric) => (
            <Grid key={metric.metric_key} size={{ xs: 12, md: 6, lg: 3 }}>
              <Card variant="outlined">
                <CardActionArea onClick={() => navigate(metric.drill_target)}>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      {metric.metric_label}
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <AssessmentOutlinedIcon fontSize="small" />
                      <Typography variant="h4">{metric.metric_value}</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {metric.unit} · {new Date(metric.as_of).toLocaleString()}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Trend summary
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Point</TableCell>
                  <TableCell align="right">Open</TableCell>
                  <TableCell align="right">In progress</TableCell>
                  <TableCell align="right">Closed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(dashboard?.trend ?? []).map((point) => (
                  <TableRow key={point.point_key}>
                    <TableCell>{point.point_label}</TableCell>
                    <TableCell align="right">{point.open_count}</TableCell>
                    <TableCell align="right">{point.in_progress_count}</TableCell>
                    <TableCell align="right">{point.closed_count}</TableCell>
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
