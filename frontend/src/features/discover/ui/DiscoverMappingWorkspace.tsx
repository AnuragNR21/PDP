import { Alert, Stack } from "@mui/material";
import { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { DiscoverShell } from "./DiscoverShell";

export function DiscoverMappingWorkspace() {
  const vm = useDiscoverWorkspace();

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
      {vm.sessionsQuery.error instanceof Error ? (
        <Alert severity="error">{vm.sessionsQuery.error.message}</Alert>
      ) : null}

      {/* DiscoverShell owns the session selection, landing state, and all steps */}
      <DiscoverShell vm={vm} />
    </Stack>
  );
}
