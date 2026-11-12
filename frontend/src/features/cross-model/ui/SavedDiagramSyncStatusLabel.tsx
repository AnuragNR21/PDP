import { CircularProgress, Stack, Typography } from "@mui/material";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import type { SavedDiagramSyncStatus } from "../state/useSavedDiagramSync";

/**
 * Tells the user where their unsaved work stands, since nothing asks them to
 * press Save any more. Silent while idle — a permanent "saved" badge on an
 * untouched canvas is noise.
 */
export function SavedDiagramSyncStatusLabel({ status }: { status: SavedDiagramSyncStatus }) {
  if (status === "idle") return null;

  const label = status === "opening" ? "Opening…"
    : status === "saving" ? "Saving…"
    : status === "saved" ? "All changes saved"
    : "Not saved — check your connection";

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {(status === "opening" || status === "saving") && <CircularProgress size={11} />}
      {status === "saved" && <CloudDoneOutlinedIcon sx={{ fontSize: 13, color: "success.main" }} />}
      {status === "error" && <CloudOffOutlinedIcon sx={{ fontSize: 13, color: "error.main" }} />}
      <Typography variant="caption" color={status === "error" ? "error.main" : "text.secondary"} noWrap>
        {label}
      </Typography>
    </Stack>
  );
}
