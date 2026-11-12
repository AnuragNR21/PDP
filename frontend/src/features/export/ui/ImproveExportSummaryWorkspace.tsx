import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { Alert, Button, Card, CardContent, Grid, Stack, Typography } from "@mui/material";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useExportPack } from "@/features/export/state/useExportWorkspace";

export function ImproveExportSummaryWorkspace() {
  const exportQuery = useExportPack();
  const pack = exportQuery.data;

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Export Summary"
      description="Feedback-safe export pack covering results, issues, actions, verifications, and trial evaluation signals."
      status="Increment 10"
    >
      <Stack spacing={3}>
        {exportQuery.error instanceof Error ? <Alert severity="error">{exportQuery.error.message}</Alert> : null}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 3 }}><Card variant="outlined"><CardContent><Typography variant="overline">Results</Typography><Typography variant="h4">{pack?.results.length ?? 0}</Typography></CardContent></Card></Grid>
          <Grid size={{ xs: 12, md: 3 }}><Card variant="outlined"><CardContent><Typography variant="overline">Issues</Typography><Typography variant="h4">{pack?.issues.length ?? 0}</Typography></CardContent></Card></Grid>
          <Grid size={{ xs: 12, md: 3 }}><Card variant="outlined"><CardContent><Typography variant="overline">Actions</Typography><Typography variant="h4">{pack?.actions.length ?? 0}</Typography></CardContent></Card></Grid>
          <Grid size={{ xs: 12, md: 3 }}><Card variant="outlined"><CardContent><Typography variant="overline">Verifications</Typography><Typography variant="h4">{pack?.verifications.length ?? 0}</Typography></CardContent></Card></Grid>
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Evaluation summary
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Generated at {pack?.generated_at ? new Date(pack.generated_at).toLocaleString() : "-"}
            </Typography>
            <Typography sx={{ mt: 2 }}>
              Events: {Number(pack?.evaluation_summary.events ?? 0)} · Follow-up requests: {Number(pack?.evaluation_summary.follow_up_requests ?? 0)}
            </Typography>
            <Typography sx={{ mt: 1 }}>
              Verification passed: {Number(pack?.evaluation_summary.verification_passed ?? 0)} · Verification failed: {Number(pack?.evaluation_summary.verification_failed ?? 0)}
            </Typography>
            <Button sx={{ mt: 2 }} variant="outlined" startIcon={<FileDownloadOutlinedIcon />}>
              JSON export ready via API
            </Button>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
