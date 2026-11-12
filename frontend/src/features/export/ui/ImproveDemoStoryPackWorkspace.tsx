import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import { Alert, Card, CardContent, Chip, Grid, Stack, Typography } from "@mui/material";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useDemoStoryPack } from "@/features/export/state/useExportWorkspace";

export function ImproveDemoStoryPackWorkspace() {
  const storyQuery = useDemoStoryPack();
  const story = storyQuery.data;

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Demo Story Pack"
      description="Presentation-quality grouping of PDP trial routes, evidence, and export assets for guided demonstrations."
      status="Increment 15"
    >
      <Stack spacing={3}>
        {storyQuery.error instanceof Error ? <Alert severity="error">{storyQuery.error.message}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">{story?.headline ?? "PDP trial demonstration pack"}</Typography>
              <Typography variant="body2" color="text.secondary">
                Generated at {story?.generated_at ? new Date(story.generated_at).toLocaleString() : "-"}
              </Typography>
              <Typography variant="body2">
                Use this page to walk the trial in a deliberate order, then lift the grouped assets into a demo deck or export handoff.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Grid container spacing={2}>
          {(story?.sections ?? []).map((section) => (
            <Grid key={section.section_code} size={{ xs: 12, md: 6 }}>
              <Card variant="outlined" sx={{ height: "100%" }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <AutoAwesomeOutlinedIcon fontSize="small" />
                      <Typography variant="h6">{section.title}</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {section.narrative}
                    </Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      {section.primary_routes.map((route) => (
                        <Chip key={route} icon={<RouteOutlinedIcon />} label={route} variant="outlined" />
                      ))}
                    </Stack>
                    <Typography variant="body2">
                      Results {section.asset_counts.results ?? 0} · Issues {section.asset_counts.issues ?? 0} · Actions {section.asset_counts.actions ?? 0} · Verifications {section.asset_counts.verifications ?? 0}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Presentation assets
            </Typography>
            <Stack spacing={1.5}>
              {(story?.presentation_assets ?? []).map((asset) => (
                <Stack key={asset.asset_code} spacing={0.5}>
                  <Typography variant="subtitle1">{asset.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {asset.description}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Source: {asset.source_endpoint}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
