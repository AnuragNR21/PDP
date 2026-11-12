import { AddOutlined, DeleteOutlined, EditOutlined } from '@mui/icons-material';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import type { CrossModelRelationshipTypeSummary } from '../../domain/types';

const KIND_LABELS: Record<string, string> = {
  HIERARCHY_MODEL: 'Hierarchy Node',
  SUPPORT_DOMAIN_MODEL: 'SD Element',
};

function SideChip({ kind, typeName, modelName }: { kind: string; typeName: string | null; modelName: string | null }) {
  const label = typeName ? `${typeName}` : KIND_LABELS[kind] ?? kind;
  const title = modelName ? `${KIND_LABELS[kind] ?? kind} · ${modelName}` : undefined;
  return (
    <Tooltip title={title}>
      <Chip label={label} size="small" variant="outlined" color={kind === 'HIERARCHY_MODEL' ? 'primary' : 'secondary'} />
    </Tooltip>
  );
}

function StatusChip({ status }: { status: string }) {
  const color = status === 'active' ? 'success' : status === 'retired' ? 'default' : 'warning';
  return <Chip label={lifecycleLabel(status)} color={color} size="small" />;
}

export function CrossModelRelationshipTypesTable(props: {
  rows: CrossModelRelationshipTypeSummary[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box>
          <Typography variant="h6">Relationship Types</Typography>
          <Typography variant="body2" color="text.secondary">
            Governed relationship types that link instances. Structure workspace instances must reference one of these types.
          </Typography>
        </Box>
        <Button variant="contained" size="small" startIcon={<AddOutlined />} onClick={props.onAdd}>
          Relationship
        </Button>
      </Box>
      {props.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No relationship types defined yet. Add one to start linking instances.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Source Type</TableCell>
              <TableCell>Target Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {props.rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {row.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.description ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <SideChip kind={row.sourceModelType} typeName={row.sourceTypeName} modelName={row.sourceModelName} />
                </TableCell>
                <TableCell>
                  <SideChip kind={row.targetModelType} typeName={row.targetTypeName} modelName={row.targetModelName} />
                </TableCell>
                <TableCell>
                  <StatusChip status={row.status} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => props.onEdit(row.id)}>
                      <EditOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => props.onDelete(row.id)}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
