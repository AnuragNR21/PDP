import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useState } from "react";
import type { EffectiveProperty } from "../api/structureApi";

export type PropertyValuesPanelProps = {
  properties: EffectiveProperty[] | undefined;
  isLoading: boolean;
  isError: boolean;
  kind: "hierarchy" | "support-domain";
  /** Shows an "Add property" action above the list when provided. */
  onAdd?: () => void;
  /** One line explaining where an added property goes. */
  addHint?: string;
};

const formatOrigin = (origin: EffectiveProperty["origin"]) =>
  origin === "inherited" ? "Inherited" : "Self-Defined";

export function PropertyValuesPanel({ onAdd, addHint, ...rest }: PropertyValuesPanelProps) {
  if (!onAdd) return <PropertyValuesTable {...rest} />;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Typography variant="caption" color="text.secondary">{addHint}</Typography>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onAdd} sx={{ flexShrink: 0 }}>
          Add property
        </Button>
      </Stack>
      <PropertyValuesTable {...rest} />
    </Stack>
  );
}

function PropertyValuesTable({
  properties,
  isLoading,
  isError,
  kind,
}: Omit<PropertyValuesPanelProps, "onAdd" | "addHint">) {
  const [selectedProperty, setSelectedProperty] = useState<EffectiveProperty | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (isError) {
    return <Alert severity="error" sx={{ py: 0 }}>Could not load properties.</Alert>;
  }
  if (!properties || properties.length === 0) {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ fontStyle: "italic" }}>
        No properties available for this instance.
      </Typography>
    );
  }

  if (kind === "support-domain") {
    return (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {properties.map((row) => (
            <TableRow key={`${row.property_id}-${row.source_element_type_id ?? "source"}`} hover>
              <TableCell>{row.property_name}</TableCell>
              <TableCell>{row.property_description ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Origin</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Inherited From</TableCell>
            <TableCell sx={{ fontWeight: 700, width: 56 }} align="center">View</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {properties.map((row) => (
            <TableRow key={`${row.property_id}-${row.source_node_type_id ?? row.source_element_type_id ?? "source"}`} hover>
              <TableCell>{row.property_name}</TableCell>
              <TableCell>{formatOrigin(row.origin)}</TableCell>
              <TableCell>{row.inherited_from ?? "-"}</TableCell>
              <TableCell align="center">
                <Tooltip title="View details">
                  <IconButton size="small" onClick={() => setSelectedProperty(row)}>
                    <VisibilityOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!selectedProperty} onClose={() => setSelectedProperty(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Property Details</DialogTitle>
        <DialogContent>
          {selectedProperty && (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2"><strong>Name:</strong> {selectedProperty.property_name}</Typography>
              <Typography variant="body2"><strong>Description:</strong> {selectedProperty.property_description || "-"}</Typography>
              <Typography variant="body2"><strong>Origin:</strong> {formatOrigin(selectedProperty.origin)}</Typography>
              <Typography variant="body2"><strong>Inherited From:</strong> {selectedProperty.inherited_from || "-"}</Typography>
              <Typography variant="body2">
                <strong>{kind === "hierarchy" ? "Source Node Type" : "Source Element Type"}:</strong>{" "}
                {selectedProperty.source_node_type_name ?? selectedProperty.source_element_type_name ?? "-"}
              </Typography>
              <Typography variant="body2"><strong>Status:</strong> {selectedProperty.property_status}</Typography>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
