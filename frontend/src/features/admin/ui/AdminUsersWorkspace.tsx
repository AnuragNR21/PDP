/**
 * Admin > Users: invite, find, edit, activate and deactivate accounts and
 * assign their roles (PDP-251 ADM-02, ADM-03).
 *
 * Invitation and reset links are shown to the administrator to pass on; the
 * platform does not send email, and the link is the only copy there is.
 */
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import PersonAddAlt1OutlinedIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AdminUserSummary, InvitationStatus } from "@/features/admin/api/adminApi";
import {
  useActivateUser,
  useAdminUsers,
  useCancelInvitation,
  useCreateUser,
  useDeactivateUser,
  useInviteUser,
  useIssuePasswordReset,
  useResendInvitation,
  useSetUserRoles,
  useUpdateUser
} from "@/features/admin/state/useAdminUsers";
import { useAuth } from "@/features/auth/state/AuthContext";
import { NewPasswordFields, newPasswordProblem } from "@/features/auth/ui/NewPasswordFields";
import { ALL_ROLES, ROLE_DESCRIPTIONS, isAdministrator, roleLabel } from "@/shared/auth/roles";
import { useToast } from "@/shared/toast/ToastContext";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";

const STATUS_OPTIONS: InvitationStatus[] = ["Active", "Invited", "Expired", "Inactive"];
const STATUS_COLOUR: Record<InvitationStatus, "success" | "info" | "warning" | "default"> = {
  Active: "success",
  Invited: "info",
  Expired: "warning",
  Inactive: "default"
};
const HEAD_SX = { "& .MuiTableHead-root .MuiTableCell-root": { fontWeight: 700, color: "text.secondary", fontSize: 12 } };

function whenText(iso: string): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** An invitation or reset link, shown once with a copy button. */
interface IssuedLink {
  title: string;
  link: string;
  expiresAt: string;
  email: string;
}

export function AdminUsersWorkspace() {
  const { user: me } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const usersQuery = useAdminUsers({ search, status: statusFilter, role: roleFilter });
  const users = usersQuery.data ?? [];
  const selected = users.find((item) => item.user_id === selectedId) ?? null;

  // Counts come from the unfiltered view of the same data when no filter is
  // on; with a filter on they describe what is listed, which is what the eye
  // compares them to.
  const counts = useMemo(
    () =>
      STATUS_OPTIONS.map((status) => ({
        label: status,
        value: users.filter((item) => item.invitation_status === status).length
      })),
    [users]
  );

  return (
    <WorkspacePage
      icon={<PersonAddAlt1OutlinedIcon />}
      workspace="Admin"
      pageTitle="Users"
      description="Invite people by email, keep their names and roles current, and switch accounts off when they leave. Only administrators see this page."
      counts={counts}
      actions={
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PersonAddOutlinedIcon />} onClick={() => setCreateOpen(true)}>
            Create user
          </Button>
          <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setInviteOpen(true)}>
            Invite user
          </Button>
        </Stack>
      }
    >
      {usersQuery.error instanceof Error ? <Alert severity="error">{usersQuery.error.message}</Alert> : null}

      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }, alignItems: "start" }}>
        <SectionPanel
          title="Users"
          flush
          toolbar={
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                placeholder="Search name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment> }}
                sx={{ minWidth: 220 }}
                inputProps={{ "aria-label": "Search users" }}
              />
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel id="users-status-label">Status</InputLabel>
                <Select labelId="users-status-label" label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {STATUS_OPTIONS.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="users-role-label">Role</InputLabel>
                <Select labelId="users-role-label" label="Role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <MenuItem value="">Any</MenuItem>
                  {ALL_ROLES.map((role) => <MenuItem key={role} value={role}>{roleLabel(role)}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
          }
        >
          <Table size="small" sx={HEAD_SX}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last sign-in</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
                    {usersQuery.isLoading ? "Loading…" : "No users match."}
                  </TableCell>
                </TableRow>
              ) : null}
              {users.map((item) => (
                <TableRow
                  key={item.user_id}
                  hover
                  selected={item.user_id === selectedId}
                  onClick={() => setSelectedId(item.user_id)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>
                    {item.display_name}
                    {me && item.user_id === me.user_id ? <Typography component="span" variant="caption" color="text.secondary"> (you)</Typography> : null}
                  </TableCell>
                  <TableCell>{item.email}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {item.roles.length === 0 ? <Typography variant="caption" color="text.secondary">None</Typography> : null}
                      {item.roles.map((role) => <Chip key={role} size="small" label={roleLabel(role)} />)}
                    </Stack>
                  </TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOUR[item.invitation_status]} label={item.invitation_status} /></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{whenText(item.last_login_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionPanel>

        <SectionPanel title={selected ? selected.display_name : "Details"} hint={selected ? selected.email : "Select a user to see and change their details."}>
          {selected ? (
            <UserDetails
              key={selected.user_id}
              user={selected}
              isSelf={Boolean(me && me.user_id === selected.user_id)}
              onIssued={setIssued}
              onRemoved={() => setSelectedId(null)}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">Nothing selected.</Typography>
          )}
        </SectionPanel>
      </Box>

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onIssued={(link, user) => {
          setInviteOpen(false);
          setSelectedId(user.user_id);
          setIssued(link);
          showToast(`${user.email} invited.`);
        }}
      />
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(user) => {
          setCreateOpen(false);
          setSelectedId(user.user_id);
          showToast(`${user.email} created.`);
        }}
      />
      <IssuedLinkDialog issued={issued} onClose={() => setIssued(null)} />
    </WorkspacePage>
  );
}

// ── details ──────────────────────────────────────────────────────────────────

function UserDetails(props: { user: AdminUserSummary; isSelf: boolean; onIssued: (link: IssuedLink) => void; onRemoved: () => void }) {
  const { user, isSelf } = props;
  const { showToast } = useToast();

  const updateMutation = useUpdateUser();
  const rolesMutation = useSetUserRoles();
  const activateMutation = useActivateUser();
  const deactivateMutation = useDeactivateUser();
  const resendMutation = useResendInvitation();
  const cancelMutation = useCancelInvitation();
  const resetMutation = useIssuePasswordReset();

  const [displayName, setDisplayName] = useState(user.display_name);
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [confirm, setConfirm] = useState<"deactivate" | "cancel" | null>(null);

  // Follow the record when a refetch changes it underneath us.
  useEffect(() => setDisplayName(user.display_name), [user.display_name]);
  useEffect(() => setRoles(user.roles), [user.roles]);

  const nameDirty = displayName.trim() !== user.display_name && displayName.trim().length > 0;
  const rolesDirty = [...roles].sort().join() !== [...user.roles].sort().join();
  const busy =
    updateMutation.isPending || rolesMutation.isPending || activateMutation.isPending || deactivateMutation.isPending ||
    resendMutation.isPending || cancelMutation.isPending || resetMutation.isPending;
  const error =
    updateMutation.error ?? rolesMutation.error ?? activateMutation.error ?? deactivateMutation.error ??
    resendMutation.error ?? cancelMutation.error ?? resetMutation.error;

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameDirty) return;
    await updateMutation.mutateAsync({ userId: user.user_id, displayName: displayName.trim() }).then(() => showToast("Name saved."), () => undefined);
  };

  const saveRoles = async (event: FormEvent) => {
    event.preventDefault();
    if (!rolesDirty) return;
    await rolesMutation.mutateAsync({ userId: user.user_id, roles }).then(() => showToast("Roles saved."), () => undefined);
  };

  const toggleRole = (role: string, on: boolean) =>
    setRoles((previous) => (on ? [...new Set([...previous, role])] : previous.filter((item) => item !== role)));

  const resend = () =>
    resendMutation
      .mutateAsync(user.user_id)
      .then((result) => props.onIssued({ title: "Invitation link", link: result.invitation_link, expiresAt: result.expires_at, email: user.email }), () => undefined);

  const issueReset = () =>
    resetMutation
      .mutateAsync(user.user_id)
      .then((result) => props.onIssued({ title: "Password reset link", link: result.reset_link, expiresAt: result.expires_at, email: user.email }), () => undefined);

  const runConfirmed = async () => {
    const action = confirm;
    setConfirm(null);
    if (action === "deactivate") {
      await deactivateMutation.mutateAsync(user.user_id).then(() => showToast(`${user.email} deactivated.`), () => undefined);
    } else if (action === "cancel") {
      await cancelMutation.mutateAsync(user.user_id).then(() => { showToast(`Invitation for ${user.email} cancelled.`); props.onRemoved(); }, () => undefined);
    }
  };

  return (
    <Stack spacing={2.5}>
      {error instanceof Error ? <Alert severity="error">{error.message}</Alert> : null}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" color={STATUS_COLOUR[user.invitation_status]} label={user.invitation_status} />
        {user.invitation_status === "Active" ? (
          <Button size="small" variant="outlined" disabled={isSelf || busy} onClick={() => setConfirm("deactivate")}>Deactivate</Button>
        ) : null}
        {user.invitation_status === "Inactive" ? (
          <Button size="small" variant="outlined" disabled={busy} onClick={() => activateMutation.mutateAsync(user.user_id).then(() => showToast(`${user.email} activated.`), () => undefined)}>Activate</Button>
        ) : null}
        {user.invitation_status === "Active" ? (
          <Button size="small" variant="text" disabled={busy} onClick={issueReset}>Password reset link</Button>
        ) : null}
        {isSelf ? <Typography variant="caption" color="text.secondary">You cannot deactivate yourself or drop your own administrator role.</Typography> : null}
      </Stack>

      {user.invitation_status === "Invited" || user.invitation_status === "Expired" ? (
        <Alert severity={user.invitation_status === "Expired" ? "warning" : "info"} sx={{ "& .MuiAlert-message": { width: "100%" } }}>
          <Stack spacing={1}>
            <span>
              {user.invitation_status === "Expired"
                ? "The invitation link has expired. Resend to issue a new one."
                : `Invitation outstanding; the link expires ${whenText(user.invitation_expires_at)}.`}
            </span>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={resend}>Resend invitation</Button>
              <Button size="small" variant="text" color="inherit" disabled={busy} onClick={() => setConfirm("cancel")}>Cancel invitation</Button>
            </Stack>
          </Stack>
        </Alert>
      ) : null}

      <form onSubmit={saveName} noValidate>
        <Stack spacing={1.5}>
          <TextField label="Email" value={user.email} fullWidth size="small" InputProps={{ readOnly: true }} />
          <TextField label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} fullWidth size="small" required inputProps={{ maxLength: 120 }} />
          <Stack direction="row" spacing={1}>
            <Button type="submit" size="small" variant="contained" startIcon={<SaveOutlinedIcon />} disabled={!nameDirty || busy}>Save</Button>
            <Button size="small" variant="text" disabled={!nameDirty || busy} onClick={() => setDisplayName(user.display_name)}>Cancel</Button>
          </Stack>
        </Stack>
      </form>

      <form onSubmit={saveRoles} noValidate>
        <Stack spacing={1}>
          <Typography variant="subtitle2">Roles</Typography>
          <FormGroup>
            {ALL_ROLES.map((role) => {
              // You may add roles to yourself, but not untick the one that
              // makes you an administrator (the API refuses that too).
              const lockedSelfAdmin = isSelf && roles.includes(role) && !isAdministrator(roles.filter((item) => item !== role));
              return (
                <FormControlLabel
                  key={role}
                  control={<Checkbox size="small" checked={roles.includes(role)} disabled={busy || lockedSelfAdmin} onChange={(event) => toggleRole(role, event.target.checked)} />}
                  label={
                    <Box>
                      <Typography variant="body2">{roleLabel(role)}</Typography>
                      <Typography variant="caption" color="text.secondary">{ROLE_DESCRIPTIONS[role]}</Typography>
                    </Box>
                  }
                  sx={{ alignItems: "flex-start", mb: 0.5 }}
                />
              );
            })}
          </FormGroup>
          <FormHelperText>Admin grants administration only; add a working role for modelling, structure or analysis, or give Super Admin for everything.</FormHelperText>
          <Stack direction="row" spacing={1}>
            <Button type="submit" size="small" variant="contained" startIcon={<SaveOutlinedIcon />} disabled={!rolesDirty || busy}>Save roles</Button>
            <Button size="small" variant="text" disabled={!rolesDirty || busy} onClick={() => setRoles(user.roles)}>Cancel</Button>
          </Stack>
        </Stack>
      </form>

      <Stack spacing={0.25}>
        <Typography variant="caption" color="text.secondary">Created {whenText(user.created_at)}</Typography>
        <Typography variant="caption" color="text.secondary">Last sign-in {whenText(user.last_login_at)}</Typography>
        {user.must_change_password ? <Typography variant="caption" color="text.secondary">Must change password at next sign-in.</Typography> : null}
      </Stack>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm === "deactivate" ? "Deactivate this account?" : "Cancel this invitation?"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === "deactivate"
              ? `${user.display_name} (${user.email}) will be signed out immediately and cannot sign in until reactivated.`
              : `The invitation for ${user.email} will be withdrawn and the pending account removed. You can invite them again later.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Keep</Button>
          <Button variant="contained" color={confirm === "deactivate" ? "warning" : "error"} onClick={runConfirmed}>
            {confirm === "deactivate" ? "Deactivate" : "Cancel invitation"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// ── invite ───────────────────────────────────────────────────────────────────

function InviteUserDialog(props: { open: boolean; onClose: () => void; onIssued: (link: IssuedLink, user: AdminUserSummary) => void }) {
  const inviteMutation = useInviteUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (props.open) {
      setEmail("");
      setDisplayName("");
      setRoles([]);
      inviteMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!emailOk) return;
    await inviteMutation
      .mutateAsync({ email: email.trim(), displayName: displayName.trim(), roles })
      .then((result) => props.onIssued({ title: "Invitation link", link: result.invitation_link, expiresAt: result.expires_at, email: result.user.email }, result.user), () => undefined);
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {inviteMutation.error instanceof Error ? <Alert severity="error">{inviteMutation.error.message}</Alert> : null}
            <TextField label="Email" type="email" autoFocus required fullWidth value={email} onChange={(event) => setEmail(event.target.value)} error={email.length > 0 && !emailOk} helperText={email.length > 0 && !emailOk ? "Enter a valid email address." : " "} />
            <TextField label="Display name" fullWidth value={displayName} onChange={(event) => setDisplayName(event.target.value)} helperText="Optional; they can change it when they accept." inputProps={{ maxLength: 120 }} />
            <RolePicker roles={roles} onChange={setRoles} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={props.onClose} disabled={inviteMutation.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!emailOk || inviteMutation.isPending}>
            {inviteMutation.isPending ? "Inviting…" : "Invite"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ── create with a password ───────────────────────────────────────────────────

/** Shared by the invite and create dialogs: which roles the new account gets. */
function RolePicker(props: { roles: string[]; onChange: (roles: string[]) => void }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Roles</Typography>
      <FormGroup>
        {ALL_ROLES.map((role) => (
          <FormControlLabel
            key={role}
            control={
              <Checkbox
                size="small"
                checked={props.roles.includes(role)}
                onChange={(event) => props.onChange(event.target.checked ? [...props.roles, role] : props.roles.filter((item) => item !== role))}
              />
            }
            label={<Typography variant="body2">{roleLabel(role)} <Typography component="span" variant="caption" color="text.secondary">– {ROLE_DESCRIPTIONS[role]}</Typography></Typography>}
          />
        ))}
      </FormGroup>
    </Box>
  );
}

function CreateUserDialog(props: { open: boolean; onClose: () => void; onCreated: (user: AdminUserSummary) => void }) {
  const createMutation = useCreateUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [mustChange, setMustChange] = useState(true);

  useEffect(() => {
    if (props.open) {
      setEmail("");
      setDisplayName("");
      setPassword("");
      setConfirm("");
      setRoles([]);
      setMustChange(true);
      createMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const passwordProblem = newPasswordProblem(password, confirm);
  const ready = emailOk && !passwordProblem;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    await createMutation
      .mutateAsync({ email: email.trim(), displayName: displayName.trim(), password, roles, mustChangePassword: mustChange })
      .then((result) => props.onCreated(result.user), () => undefined);
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>Create a user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>
              The account is active immediately with the password you set here. Tell the person their password yourself; it is not shown again.
            </DialogContentText>
            {createMutation.error instanceof Error ? <Alert severity="error">{createMutation.error.message}</Alert> : null}
            <TextField label="Email" type="email" autoFocus required fullWidth value={email} onChange={(event) => setEmail(event.target.value)} error={email.length > 0 && !emailOk} helperText={email.length > 0 && !emailOk ? "Enter a valid email address." : " "} />
            <TextField label="Display name" fullWidth value={displayName} onChange={(event) => setDisplayName(event.target.value)} helperText="Optional; they can change it later." inputProps={{ maxLength: 120 }} />
            <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
            <FormControlLabel
              control={<Switch checked={mustChange} onChange={(event) => setMustChange(event.target.checked)} />}
              label={<Typography variant="body2">Require a new password at first sign-in</Typography>}
            />
            <RolePicker roles={roles} onChange={setRoles} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={props.onClose} disabled={createMutation.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!ready || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create user"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ── the link, shown once ─────────────────────────────────────────────────────

function IssuedLinkDialog(props: { issued: IssuedLink | null; onClose: () => void }) {
  const { showToast } = useToast();
  const issued = props.issued;

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      showToast("Link copied.");
    } catch {
      showToast("Copy failed; select the link and copy it by hand.", "warning");
    }
  };

  return (
    <Dialog open={issued !== null} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{issued?.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <DialogContentText>
            Send this link to {issued?.email}. It is shown only now, works once, and expires {whenText(issued?.expiresAt ?? "")}.
          </DialogContentText>
          <TextField value={issued?.link ?? ""} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(event) => event.target.select()} inputProps={{ "aria-label": "Link" }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
        <Button variant="contained" startIcon={<ContentCopyOutlinedIcon />} onClick={copy}>Copy link</Button>
      </DialogActions>
    </Dialog>
  );
}
