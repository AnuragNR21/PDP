import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import { Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";

import { useAuditRecords } from "@/features/admin/state/useAdminWorkspace";

export function AdminAuditWorkspace() {
  const auditQuery = useAuditRecords();

  return (
    <WorkspacePage
      icon={<ReceiptLongOutlinedIcon />}
      workspace="Admin"
      pageTitle="Audit log"
      description="Sign-ins, sign-outs, user and role changes and configuration updates, newest first. Records are read-only."
    >
      <Stack spacing={1}>
        <SectionPanel title="Recent audit records" flush>
            <Table size="small" sx={{ "& .MuiTableHead-root .MuiTableCell-root": { fontWeight: 700, color: "text.secondary", fontSize: 12 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Object</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(auditQuery.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
                      {auditQuery.isLoading ? "Loading…" : "No audit records yet."}
                    </TableCell>
                  </TableRow>
                )}
                {(auditQuery.data ?? []).map((record) => (
                  <TableRow key={record.audit_id}>
                    <TableCell>{new Date(record.created_at).toLocaleString()}</TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={record.category} sx={{ height: 20, fontSize: 11 }} /></TableCell>
                    <TableCell>{record.action_code}</TableCell>
                    <TableCell>{record.object_ref}</TableCell>
                    <TableCell>{record.actor_label}</TableCell>
                    <TableCell>{record.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionPanel>
      </Stack>
    </WorkspacePage>
  );
}
