import { Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { HierarchyNodeSummary, HierarchyRuleSummary } from '../../domain/types';
import { displayLabel } from '../../domain/utils';

export function StructuralRulesTable({ rows, nodes }: { rows: HierarchyRuleSummary[]; nodes: HierarchyNodeSummary[] }) {
  const nodeLabels = new Map(nodes.map((node) => [node.id, displayLabel(node)]));
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Parent Node Type</TableCell>
          <TableCell>Child Node Type</TableCell>
          <TableCell>Recursive</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const isRecursive = row.relationshipKind === 'recursive';
          return (
            <TableRow key={row.id}>
              <TableCell>{nodeLabels.get(row.parentNodeId) ?? row.parentName ?? row.parentNodeId}</TableCell>
              <TableCell>{nodeLabels.get(row.childNodeId) ?? row.childName ?? row.childNodeId}</TableCell>
              <TableCell>
                {isRecursive ? (
                  <Chip label="Yes" size="small" color="primary" variant="outlined" />
                ) : (
                  <Typography variant="body2" color="text.secondary">No</Typography>
                )}
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">{row.status}</Typography>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
