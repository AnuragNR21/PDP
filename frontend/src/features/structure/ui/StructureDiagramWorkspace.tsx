import DeviceHubOutlinedIcon from "@mui/icons-material/DeviceHubOutlined";
import LinearScaleOutlinedIcon from "@mui/icons-material/LinearScaleOutlined";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography
} from "@mui/material";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useStructureDiagramProjection } from "@/features/structure/state/useStructureDiagramProjection";
import { ProjectionModelPicker, useProjectionModel } from "./ProjectionModelPicker";

export function StructureDiagramWorkspace() {
  const picker = useProjectionModel();
  const { data, isLoading, error } = useStructureDiagramProjection(picker.modelId);

  return (
    <WorkspacePageTemplate
      workspace="Structure"
      pageTitle="Diagram"
      description="Non-authoritative projection over the canonical hierarchy and typed relationships."
    >
      <Stack spacing={3}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Card sx={{ minWidth: 220 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Projection model
              </Typography>
              <ProjectionModelPicker value={picker.modelId} options={picker.options} onChange={picker.setModelId} />
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 220 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Nodes
              </Typography>
              <Typography variant="h6">{data?.nodes.length ?? 0}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 220 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Edges
              </Typography>
              <Typography variant="h6">{data?.edges.length ?? 0}</Typography>
            </CardContent>
          </Card>
        </Stack>

        {!picker.isLoading && picker.options.length === 0 ? <Alert severity="info">No hierarchy model yet. Create one in the Model Workspace.</Alert> : null}
        {isLoading && picker.modelId ? <Typography>Loading diagram projection...</Typography> : null}
        {error instanceof Error ? <Alert severity="error">{error.message}</Alert> : null}

        {data ? (
          <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="stretch">
            <Card sx={{ flex: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Node layout
                </Typography>
                <Stack spacing={1.5}>
                  {data.nodes.map((node) => (
                    <Box
                      key={node.node_id}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 2,
                        p: 2,
                        ml: `${node.level * 4}px`
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Stack>
                          <Typography fontWeight={600}>{node.name}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {node.badge || node.node_type_id} · level {node.level} · ({node.x}, {node.y})
                          </Typography>
                        </Stack>
                        <Chip icon={<DeviceHubOutlinedIcon />} label={node.node_id} size="small" />
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Edge catalogue
                </Typography>
                <Stack divider={<Divider flexItem />}>
                  {data.edges.map((edge) => (
                    <Box key={edge.edge_id} sx={{ py: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Typography fontWeight={600}>{edge.semantic_key}</Typography>
                        <Chip icon={<LinearScaleOutlinedIcon />} label={edge.projection_kind} size="small" />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {edge.source_node_id} → {edge.target_node_id}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        ) : null}
      </Stack>
    </WorkspacePageTemplate>
  );
}
