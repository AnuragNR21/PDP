/** The centred card the sign-in, reset and invitation pages share. */
import { Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export function AuthPageFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2
      }}
    >
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 420, p: 4 }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box component="img" src="/pdp-logo.png" alt="PDP Logo" sx={{ height: 40, width: 40, objectFit: "contain" }} />
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                Power Data Platform
              </Typography>
              <Typography variant="caption" color="text.secondary">
                A Data Intelligence Platform for Power Utilities
              </Typography>
            </Box>
          </Stack>
          <Box>
            <Typography variant="h5" fontWeight={700}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}
