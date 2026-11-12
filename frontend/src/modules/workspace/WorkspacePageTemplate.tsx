import { PropsWithChildren } from "react";
import { Box, Breadcrumbs, Chip, Paper, Stack, Typography } from "@mui/material";

type Props = PropsWithChildren<{
  workspace: string;
  pageTitle: string;
  description: string;
  status?: string;
}>;

export function WorkspacePageTemplate({
  workspace,
  pageTitle,
  description,
  status = "Foundation",
  children
}: Props) {
  return (
    <Stack spacing={3}>
      <Box>
        <Breadcrumbs sx={{ mb: 1 }}>
          <Typography color="text.primary">{workspace}</Typography>
          <Typography color="text.secondary">{pageTitle}</Typography>
        </Breadcrumbs>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h4">{`${workspace} > ${pageTitle}`}</Typography>
          <Chip label={status} size="small" />
        </Stack>
        <Typography color="text.secondary">{description}</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 3 }}>
        {children}
      </Paper>
    </Stack>
  );
}
