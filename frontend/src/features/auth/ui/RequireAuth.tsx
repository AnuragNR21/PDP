/**
 * The gate in front of the application shell.
 *
 * Nobody signed in: off to the sign-in page, remembering where they were
 * going. A person who must change their password (the seeded admin on first
 * use) goes to their profile first and nowhere else.
 */
import { Box, CircularProgress } from "@mui/material";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/state/AuthContext";

export const PROFILE_ROUTE = "/profile";

export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status === "anonymous" || !user) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (user.must_change_password && location.pathname !== PROFILE_ROUTE) {
    return <Navigate to={PROFILE_ROUTE} replace />;
  }

  return <Outlet />;
}
