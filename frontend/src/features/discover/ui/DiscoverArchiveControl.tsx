/**
 * Retiring a finished session, and taking it back.
 *
 * The button appears only once the session has been checked at least once —
 * archiving puts away finished work, and an unchecked session is not
 * finished. Whether that is true is answered by the server rather than worked
 * out here, so the button and the endpoint cannot disagree.
 *
 * Archiving deletes nothing today. It starts a countdown set in Admin →
 * Data retention, and the dialog says the date out loud before anyone agrees
 * to it: a deletion nobody saw coming is the one people complain about.
 */
import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import { DISPLAY_ZONE_LABEL, daysUntil, readableDate } from "./displayTime";
import type { useDiscoverWorkspace } from "../state/useDiscoverWorkspace";

type Vm = ReturnType<typeof useDiscoverWorkspace>;

export function DiscoverArchiveControl({ vm }: { vm: Vm }) {
  const [confirming, setConfirming] = useState(false);
  const eligibility = vm.archiveEligibilityQuery.data;
  const session = vm.currentSessionQuery.data;
  const archiving = vm.archiveSessionMutation.isPending;
  const restoring = vm.restoreSessionMutation.isPending;

  if (!vm.selectedSessionId || !eligibility) return null;

  const dueAt = session?.purge_due_at || eligibility.purge_due_at || "";

  // ── already archived: say when it goes, and offer the way back ───────────
  if (eligibility.is_archived) {
    const left = daysUntil(dueAt);
    return (
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Tooltip
          title={
            dueAt
              ? `Scheduled for deletion on ${readableDate(dueAt)} (${DISPLAY_ZONE_LABEL} time). Restoring stops that.`
              : "Restoring takes this session out of the archive."
          }
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<UnarchiveOutlinedIcon />}
              disabled={restoring}
              onClick={() => vm.restoreSessionMutation.mutate()}
              sx={{ textTransform: "none", fontWeight: 600, whiteSpace: "nowrap" }}
            >
              {restoring ? "Restoring…" : "Restore"}
            </Button>
          </span>
        </Tooltip>
        {dueAt && (
          <Typography variant="caption" color="warning.main" fontWeight={600}>
            Deleted in {left} day{left === 1 ? "" : "s"} · {readableDate(dueAt)}
          </Typography>
        )}
        {vm.restoreSessionMutation.isError && (
          <Typography variant="caption" color="error.main">
            {(vm.restoreSessionMutation.error as Error)?.message ?? "Could not restore."}
          </Typography>
        )}
      </Stack>
    );
  }

  // Asked for: the button shows up only once the session is active and the
  // quality check has run. Before that there is nothing here at all.
  if (!eligibility.can_archive) return null;

  const days = eligibility.retention_days ?? 0;

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<Inventory2OutlinedIcon />}
        onClick={() => setConfirming(true)}
        sx={{ textTransform: "none", fontWeight: 600, whiteSpace: "nowrap" }}
      >
        Archive
      </Button>

      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Archive this session?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              <strong>{session?.name}</strong> moves to the Archived list. Its files,
              mappings and quality results stay exactly as they are and you can still
              open it.
            </Typography>
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              It will be <strong>permanently deleted after {days} day
              {days === 1 ? "" : "s"}</strong>
              {" "}— around {readableDate(
                new Date(Date.now() + days * 86_400_000).toISOString()
              )}. Deleting takes the files, rows, mappings and findings with it,
              and cannot be undone.
            </Alert>
            <Typography variant="caption" color="text.secondary">
              Restore it before then and the countdown stops. An administrator sets
              how long sessions are kept under Admin → Data retention.
            </Typography>
          </DialogContentText>
          {vm.archiveSessionMutation.isError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {(vm.archiveSessionMutation.error as Error)?.message ??
                "Could not archive this session."}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirming(false)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={archiving}
            onClick={() =>
              vm.archiveSessionMutation.mutate(undefined, {
                onSuccess: () => setConfirming(false),
              })
            }
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {archiving ? "Archiving…" : "Archive session"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
