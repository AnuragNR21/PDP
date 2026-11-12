import { Box, Card, CardContent, Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { HierarchyNodeSummary, HierarchyRuleSummary } from '../../domain/types';
import { displayLabel } from '../../domain/utils';

export function HierarchyRulesTable({
  rows,
  nodes,
}: {
  rows: HierarchyRuleSummary[];
  nodes: HierarchyNodeSummary[];
}) {
  const nodeLabels = new Map(nodes.map((node) => [node.id, displayLabel(node)]));

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box>
            <Typography variant="h6">Hierarchy Rules</Typography>
            <Typography variant="body2" color="text.secondary">
              Auto-generated from hierarchy + recursive rules
            </Typography>
          </Box>
        </Box>
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
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
                    No rules yet. Rules are auto-generated when you build the node type hierarchy.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
