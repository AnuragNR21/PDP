/** A section of the shell only some roles may open; everyone else sees why. */
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/state/AuthContext";
import { roleLabel } from "@/shared/auth/roles";

export function RequireRole({ role }: { role: string }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  if (hasRole(role)) return <Outlet />;

  return (
    <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 520, width: "100%", textAlign: "center" }}>
        <Stack spacing={1.5} alignItems="center">
          <LockOutlinedIcon color="action" sx={{ fontSize: 40 }} />
          <Typography variant="h6" fontWeight={700}>
            This area is for {roleLabel(role)} users
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your account does not hold the {roleLabel(role)} role. Ask an administrator if you need it.
          </Typography>
          <Button variant="contained" onClick={() => navigate("/home")}>
            Go to Home
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
