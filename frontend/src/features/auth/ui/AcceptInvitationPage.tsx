import { Alert, Button, CircularProgress, Link, Stack, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { authApi } from "@/features/auth/api/authApi";
import { AuthPageFrame } from "@/features/auth/ui/AuthPageFrame";
import { NewPasswordFields, newPasswordProblem } from "@/features/auth/ui/NewPasswordFields";

export function AcceptInvitationPage() {
  const { token = "" } = useParams();
  const preview = useQuery({
    queryKey: ["auth", "invitation", token],
    queryFn: () => authApi.previewInvitation(token),
    retry: false
  });
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preview.data && !displayName) setDisplayName(preview.data.display_name);
  }, [preview.data, displayName]);

  const problem = newPasswordProblem(password, confirm) ?? (displayName.trim() ? null : "Enter your name.");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    setError(null);
    setBusy(true);
    try {
      await authApi.acceptInvitation(token, displayName.trim(), password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  if (preview.isLoading) {
    return (
      <AuthPageFrame title="Checking your invitation…">
        <Stack alignItems="center">
          <CircularProgress />
        </Stack>
      </AuthPageFrame>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <AuthPageFrame title="Invitation not available">
        <Stack spacing={2}>
          <Alert severity="error">
            {preview.error instanceof Error ? preview.error.message : "This invitation is not valid or has expired."}
          </Alert>
          <Link component={RouterLink} to="/login" variant="body2" sx={{ alignSelf: "center" }}>
            Go to sign in
          </Link>
        </Stack>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame title="Welcome to PDP" subtitle={`Set up your account for ${preview.data.email}.`}>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {done ? (
            <Alert severity="success">Your account is ready. Sign in with your email and the password you chose.</Alert>
          ) : (
            <>
              <TextField
                label="Your name"
                required
                fullWidth
                autoFocus
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} label="Password" />
            </>
          )}
          {!done ? (
            <Button type="submit" variant="contained" size="large" disabled={busy || Boolean(problem)}>
              {busy ? "Saving…" : "Create my account"}
            </Button>
          ) : null}
          <Link component={RouterLink} to="/login" variant="body2" sx={{ alignSelf: "center" }}>
            {done ? "Go to sign in" : "Already have an account? Sign in"}
          </Link>
        </Stack>
      </form>
    </AuthPageFrame>
  );
}
