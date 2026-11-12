import { Alert, Button, Link, Stack, TextField } from "@mui/material";
import { useState, type FormEvent } from "react";
import { Link as RouterLink } from "react-router-dom";
import { authApi } from "@/features/auth/api/authApi";
import { AuthPageFrame } from "@/features/auth/ui/AuthPageFrame";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await authApi.forgotPassword(email);
      setSent(response.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageFrame title="Reset your password" subtitle="Enter your email address and an administrator-issued reset link will follow.">
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {sent ? <Alert severity="success">{sent}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            fullWidth
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={Boolean(sent)}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || !email || Boolean(sent)}>
            {busy ? "Sending…" : "Request reset link"}
          </Button>
          <Link component={RouterLink} to="/login" variant="body2" sx={{ alignSelf: "center" }}>
            Back to sign in
          </Link>
        </Stack>
      </form>
    </AuthPageFrame>
  );
}
