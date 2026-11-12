import { Alert, Button, Link, Stack, TextField } from "@mui/material";
import { useState, type FormEvent } from "react";
import { Navigate, Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/state/AuthContext";
import { AuthPageFrame } from "@/features/auth/ui/AuthPageFrame";
import { PROFILE_ROUTE } from "@/features/auth/ui/RequireAuth";

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && from !== "/login" ? from : "/home";

  if (status === "authenticated") return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      navigate(user.must_change_password ? PROFILE_ROUTE : destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageFrame title="Sign in" subtitle="Use the email address and password you were given.">
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            fullWidth
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            fullWidth
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: "center" }}>
            Forgotten your password?
          </Link>
        </Stack>
      </form>
    </AuthPageFrame>
  );
}
