import { Alert, Button, Link, Stack, TextField } from "@mui/material";
import { useState, type FormEvent } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { authApi } from "@/features/auth/api/authApi";
import { AuthPageFrame } from "@/features/auth/ui/AuthPageFrame";
import { NewPasswordFields, newPasswordProblem } from "@/features/auth/ui/NewPasswordFields";

export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = newPasswordProblem(password, confirm);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    setError(null);
    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be reset.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageFrame title="Choose a new password">
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {done ? (
            <Alert severity="success">Your password has been changed. You can sign in with it now.</Alert>
          ) : (
            <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          )}
          {!done ? (
            <Button type="submit" variant="contained" size="large" disabled={busy || Boolean(problem)}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          ) : null}
          <Link component={RouterLink} to="/login" variant="body2" sx={{ alignSelf: "center" }}>
            {done ? "Go to sign in" : "Back to sign in"}
          </Link>
        </Stack>
      </form>
    </AuthPageFrame>
  );
}
