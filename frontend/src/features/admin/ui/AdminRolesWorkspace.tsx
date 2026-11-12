/**
 * Admin > Roles & Permissions: the four fixed roles and the read-only matrix
 * of what each may change (PDP-251 ADM-03). Roles are assigned per user on
 * the Users page; the matrix itself is fixed in the backend.
 */
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { Alert, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useAdminRoles } from "@/features/admin/state/useAdminUsers";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";

const HEAD_SX = { "& .MuiTableHead-root .MuiTableCell-root": { fontWeight: 700, color: "text.secondary", fontSize: 12 } };

export function AdminRolesWorkspace() {
  const rolesQuery = useAdminRoles();
  const roles = rolesQuery.data?.roles ?? [];
  const permissions = rolesQuery.data?.permissions ?? [];

  return (
    <WorkspacePage
      icon={<VerifiedUserOutlinedIcon />}
      workspace="Admin"
      pageTitle="Roles & Permissions"
      description="The fixed roles and the functions each one unlocks. A person with several roles has all of their permissions; Admin alone grants no modelling, structure or analysis rights, while Super Admin grants everything."
    >
      <Stack spacing={1}>
        {rolesQuery.error instanceof Error ? <Alert severity="error">{rolesQuery.error.message}</Alert> : null}

        <SectionPanel title="Roles" flush>
          <Table size="small" sx={HEAD_SX}>
            <TableHead>
              <TableRow>
                <TableCell>Role</TableCell>
                <TableCell>Grants</TableCell>
                <TableCell align="right">Active users</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
                    {rolesQuery.isLoading ? "Loading…" : "No roles defined."}
                  </TableCell>
                </TableRow>
              ) : null}
              {roles.map((role) => (
                <TableRow key={role.role_code}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Chip size="small" label={role.label} />
                  </TableCell>
                  <TableCell>{role.description}</TableCell>
                  <TableCell align="right">{role.active_users}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionPanel>

        <SectionPanel title="Permissions matrix" hint="Read-only. Every active user can view all workspaces; a tick marks who can create, edit or delete there." flush>
          <Table size="small" sx={HEAD_SX}>
            <TableHead>
              <TableRow>
                <TableCell>Area</TableCell>
                <TableCell>Function</TableCell>
                {roles.map((role) => (
                  <TableCell key={role.role_code} align="center" sx={{ whiteSpace: "nowrap" }}>{role.label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {permissions.map((entry) => (
                <TableRow key={`${entry.area}:${entry.function}`}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Typography variant="body2" fontWeight={600}>{entry.area}</Typography>
                  </TableCell>
                  <TableCell>{entry.function}</TableCell>
                  {roles.map((role) => (
                    <TableCell key={role.role_code} align="center" aria-label={entry.roles.includes(role.role_code) ? `${role.label} may` : `${role.label} may not`}>
                      {entry.roles.includes(role.role_code) ? <CheckCircleOutlineIcon fontSize="small" color="success" /> : <Typography variant="body2" color="text.disabled">–</Typography>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionPanel>
      </Stack>
    </WorkspacePage>
  );
}
