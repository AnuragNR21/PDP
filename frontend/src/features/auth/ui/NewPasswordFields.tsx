/** Password + confirmation, with the one rule the backend also enforces. */
import { Stack, TextField } from "@mui/material";

export const MIN_PASSWORD_LENGTH = 8;

export function newPasswordProblem(password: string, confirm: string): string | null {
  if (!password) return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.trim() !== password) return "The password cannot start or end with a space.";
  if (confirm !== password) return "The two passwords do not match.";
  return null;
}

export function NewPasswordFields(props: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  label?: string;
  autoFocus?: boolean;
}) {
  const mismatch = props.confirm.length > 0 && props.confirm !== props.password;
  const short = props.password.length > 0 && props.password.length < MIN_PASSWORD_LENGTH;
  return (
    <Stack spacing={2}>
      <TextField
        label={props.label ?? "New password"}
        type="password"
        autoComplete="new-password"
        autoFocus={props.autoFocus}
        required
        fullWidth
        value={props.password}
        onChange={(event) => props.onPassword(event.target.value)}
        error={short}
        helperText={short ? `At least ${MIN_PASSWORD_LENGTH} characters.` : " "}
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        fullWidth
        value={props.confirm}
        onChange={(event) => props.onConfirm(event.target.value)}
        error={mismatch}
        helperText={mismatch ? "The two passwords do not match." : " "}
      />
    </Stack>
  );
}
