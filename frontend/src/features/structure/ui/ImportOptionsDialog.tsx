import { type ChangeEvent, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";

export type ImportOptionScope = "hierarchy" | "sd-elements" | "sd-relationships";

// Temporarily disabled while SD element relationship import/export is under internal testing.
// Re-enable by restoring the "sd-relationships" option below (and the export flag in
// StructureImportExportPanel).
const IMPORT_OPTIONS: { scope: ImportOptionScope; label: string }[] = [
  { scope: "hierarchy", label: "Import Hierarchy node instances" },
  { scope: "sd-elements", label: "Import SD element instances & diagram links" },
  // { scope: "sd-relationships", label: "Import SD element relationships" },
];

type ImportOptionsDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (scope: ImportOptionScope, file: File) => void;
};

export function ImportOptionsDialog({ open, onClose, onConfirm }: ImportOptionsDialogProps) {
  const [scope, setScope] = useState<ImportOptionScope | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      setScope(null);
      setFile(null);
    }
  }, [open]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    // Allow re-selecting the same file later.
    event.target.value = "";
  }

  function handleConfirm() {
    if (scope && file) {
      onConfirm(scope, file);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import Data</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">What do you want to import?</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {IMPORT_OPTIONS.map((option) => (
                <Chip
                  key={option.scope}
                  label={option.label}
                  color={scope === option.scope ? "primary" : "default"}
                  variant={scope === option.scope ? "filled" : "outlined"}
                  onClick={() => setScope(option.scope)}
                />
              ))}
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">File</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                component="label"
                variant="outlined"
                startIcon={<UploadFileOutlinedIcon />}
                disabled={!scope}
              >
                Choose file
                <input
                  hidden
                  type="file"
                  accept="text/csv,.csv,application/json,.json"
                  onChange={handleFileChange}
                />
              </Button>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  color={file ? "text.primary" : "text.secondary"}
                  sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {file ? file.name : "No file selected"}
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!scope || !file}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
