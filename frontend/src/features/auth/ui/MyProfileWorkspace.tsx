/**
 * My Profile: what a person can see and change about their own account.
 *
 * Roles and status are shown but not editable here — only an Admin changes
 * those, and never their own (PDP-251 §3).
 */
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { Alert, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useState, type FormEvent } from "react";
import { authApi } from "@/features/auth/api/authApi";
import { useAuth } from "@/features/auth/state/AuthContext";
import { NewPasswordFields, newPasswordProblem } from "@/features/auth/ui/NewPasswordFields";
import { roleLabel } from "@/shared/auth/roles";
import { useToast } from "@/shared/toast/ToastContext";
import { SectionPanel } from "@/shared/workspace/WorkspaceHeaderCard";
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";

const PROFILE_COLOR = "#3A7A57";

export function MyProfileWorkspace() {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;

  const profileDirty = displayName.trim() !== user.display_name && displayName.trim().length > 0;
  const passwordProblem = newPasswordProblem(newPassword, confirmPassword) ?? (currentPassword ? null : "Enter your current password.");

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileDirty) return;
    setProfileError(null);
    setSavingProfile(true);
    try {
      const response = await authApi.updateMe(displayName.trim());
      setUser(response.user);
      showToast("Display name updated.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "The name could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordProblem) return;
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setUser({ ...user, must_change_password: false });
      showToast("Password changed.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "The password could not be changed.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <WorkspacePage
      icon={<PersonOutlineOutlinedIcon />}
      color={PROFILE_COLOR}
      workspace="Account"
      pageTitle="My Profile"
      description="Your name, your sign-in details and the roles an administrator has given you."
    >
      <Stack spacing={1}>
        {user.must_change_password ? (
          <Alert severity="warning">
            Please choose a new password before continuing. The one you signed in with was issued for first use only.
          </Alert>
        ) : null}

        <SectionPanel title="Account">
          <form onSubmit={saveProfile} noValidate>
            <Stack spacing={2} sx={{ maxWidth: 520 }}>
              {profileError ? <Alert severity="error">{profileError}</Alert> : null}
              <TextField label="Email" value={user.email} fullWidth InputProps={{ readOnly: true }} helperText="Your email is your sign-in name and cannot be changed here." />
              <TextField
                label="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                fullWidth
                required
                inputProps={{ maxLength: 120 }}
              />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="text.secondary">Roles:</Typography>
                {user.roles.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">None assigned yet</Typography>
                ) : (
                  user.roles.map((role) => <Chip key={role} size="small" label={roleLabel(role)} />)
                )}
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" startIcon={<SaveOutlinedIcon />} disabled={!profileDirty || savingProfile}>
                  Save
                </Button>
                <Button variant="text" disabled={!profileDirty || savingProfile} onClick={() => setDisplayName(user.display_name)}>
                  Cancel
                </Button>
              </Stack>
            </Stack>
          </form>
        </SectionPanel>

        <SectionPanel title="Change password">
          <form onSubmit={savePassword} noValidate>
            <Stack spacing={2} sx={{ maxWidth: 520 }}>
              {passwordError ? <Alert severity="error">{passwordError}</Alert> : null}
              <TextField
                label="Current password"
                type="password"
                autoComplete="current-password"
                autoFocus={user.must_change_password}
                required
                fullWidth
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <NewPasswordFields
                password={newPassword}
                confirm={confirmPassword}
                onPassword={setNewPassword}
                onConfirm={setConfirmPassword}
              />
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" startIcon={<SaveOutlinedIcon />} disabled={Boolean(passwordProblem) || savingPassword}>
                  Change password
                </Button>
                <Button
                  variant="text"
                  disabled={savingPassword || (!currentPassword && !newPassword && !confirmPassword)}
                  onClick={() => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordError(null); }}
                >
                  Cancel
                </Button>
              </Stack>
            </Stack>
          </form>
        </SectionPanel>
      </Stack>
    </WorkspacePage>
  );
}
