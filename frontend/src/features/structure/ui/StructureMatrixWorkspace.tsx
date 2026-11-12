import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import RadioButtonUncheckedOutlinedIcon from "@mui/icons-material/RadioButtonUncheckedOutlined";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useStructureMatrixProjection } from "@/features/structure/state/useStructureMatrixProjection";
import { ProjectionModelPicker, useProjectionModel } from "./ProjectionModelPicker";

export function StructureMatrixWorkspace() {
  const picker = useProjectionModel();
  const { data, isLoading, error } = useStructureMatrixProjection(picker.modelId);

  const cellsByKey = new Map(
    (data?.cells ?? []).map((cell) => [`${cell.row_node_id}::${cell.column_node_id}`, cell])
  );

  return (
    <WorkspacePageTemplate
      workspace="Structure"
      pageTitle="Matrix"
      description="Projection matrix of entity-to-attribute coverage derived from authoritative structure."
    >
      <Stack spacing={3}>
        <ProjectionModelPicker value={picker.modelId} options={picker.options} onChange={picker.setModelId} />
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Chip label={`Rows ${data?.rows.length ?? 0}`} />
          <Chip label={`Columns ${data?.columns.length ?? 0}`} />
          <Chip label={`Linked cells ${(data?.cells ?? []).filter((cell) => cell.linked).length}`} />
        </Stack>

        {!picker.isLoading && picker.options.length === 0 ? <Alert severity="info">No hierarchy model yet. Create one in the Model Workspace.</Alert> : null}
        {isLoading && picker.modelId ? <Typography>Loading matrix projection...</Typography> : null}
        {data && (data.rows.length === 0 || data.columns.length === 0) ? (
          <Alert severity="info">
            This matrix crosses Entity nodes with Attribute nodes, and the selected model has {data.rows.length === 0 ? "no Entity nodes" : "no Attribute nodes"}. The model's own Matrix is in the Structure Workspace.
          </Alert>
        ) : null}
        {error instanceof Error ? <Alert severity="error">{error.message}</Alert> : null}

        {data ? (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Entity × Attribute matrix
              </Typography>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 240 }}>Entity</TableCell>
                      {data.columns.map((column) => (
                        <TableCell key={column.node_id} align="center" sx={{ minWidth: 180 }}>
                          <Typography fontWeight={600}>{column.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {column.badge || column.node_type_id}
                          </Typography>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TableRow key={row.node_id} hover>
                        <TableCell>
                          <Typography fontWeight={600}>{row.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.node_id}
                          </Typography>
                        </TableCell>
                        {data.columns.map((column) => {
                          const cell = cellsByKey.get(`${row.node_id}::${column.node_id}`);
                          return (
                            <TableCell key={column.node_id} align="center">
                              <Stack alignItems="center" spacing={0.5}>
                                {cell?.linked ? (
                                  <CheckCircleOutlineOutlinedIcon color="success" fontSize="small" />
                                ) : (
                                  <RadioButtonUncheckedOutlinedIcon color="disabled" fontSize="small" />
                                )}
                                <Typography variant="caption" color="text.secondary">
                                  {cell?.semantic_key ?? "—"}
                                </Typography>
                              </Stack>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </WorkspacePageTemplate>
  );
}
