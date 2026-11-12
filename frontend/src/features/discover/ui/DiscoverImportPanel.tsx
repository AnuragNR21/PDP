import { useState, useRef, useEffect, useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import CloseIcon from "@mui/icons-material/Close";
import type { useDiscoverWorkspace } from "@/features/discover/state/useDiscoverWorkspace";
import { SourceApplicationLine } from "@/features/discover/ui/DiscoverSourceApplication";

// ── Configurable limits (matches backend AdminImportConfig defaults) ─────────
// These are UI-side guards only. The authoritative check is on the backend.
const LIMITS = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
  MAX_FILE_SIZE_LABEL: "100 MB",
  // The server parses these formats; legacy .xls is not readable, so it is not
  // offered here rather than failing after upload.
  ACCEPTED_TYPES: [".csv", ".xlsx"],
  ACCEPTED_MIME: [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  vm: ReturnType<typeof useDiscoverWorkspace>;
};

/** Where one file's job has got to, as a single mark. */
/**
 * What is happening to one file, in its own words.
 *
 * The job's status decides, and the tables it produced only fill in the
 * detail. Reading the tables first meant a file whose job had succeeded
 * dropped back to "Waiting for Start import" whenever the session's file
 * list was momentarily between fetches — a finished file with a green tick
 * telling the person to start the import again.
 */
function describe(
  job: { status: string; stage: string; message: string; rows_done: number; rows_total: number; table_names: string[]; tables_created: number } | undefined,
  tables: { sheet_name?: string | null; column_count?: number | null }[],
): string {
  const fromTables = () => {
    if (tables.length > 0) {
      const sheets = tables.map((t) => t.sheet_name).filter(Boolean);
      if (sheets.length > 0) return sheets.join(" · ");
      return `${tables[0]?.column_count ?? 0} columns`;
    }
    // The job knows what it produced even before the file list catches up.
    if (job?.table_names?.length) return job.table_names.join(" · ");
    return job?.tables_created
      ? `${job.tables_created} table${job.tables_created === 1 ? "" : "s"}`
      : "";
  };

  if (!job) return fromTables() || "Imported";
  if (job.status === "failed") return job.message;
  if (job.status === "running" || job.status === "queued") {
    return job.rows_total
      ? `${job.stage} — ${job.rows_done.toLocaleString()} of ${job.rows_total.toLocaleString()} rows`
      : job.stage;
  }
  if (job.status === "succeeded") return fromTables() || "Imported";
  return "Waiting for Start import";
}

function JobIcon({ status }: { status?: string }) {
  if (status === "running" || status === "queued") {
    return <CircularProgress size={16} sx={{ mt: 0.35 }} />;
  }
  if (status === "succeeded") {
    return <CheckCircleOutlineIcon fontSize="small" color="success" sx={{ mt: 0.25 }} />;
  }
  if (status === "failed") {
    return <ErrorOutlineIcon fontSize="small" color="error" sx={{ mt: 0.25 }} />;
  }
  return <InsertDriveFileOutlinedIcon fontSize="small" color="action" sx={{ mt: 0.25 }} />;
}

export function DiscoverImportPanel({ vm }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const sessionFiles = vm.sourceFilesQuery.data ?? [];

  /** Files still going up, each with its own bar. See useSourceFileUploads. */
  const uploads_ = vm.fileUploads;
  const uploading = uploads_.isUploading;

  const report = vm.importProgressQuery.data;
  const jobs = report?.jobs ?? [];

  /**
   * One row per uploaded file: the job that will read it, and whatever tables
   * it has produced so far.
   *
   * This step is about the file — the person picked "network_assets.xlsx", not
   * "network_assets.xlsx — Poles" — so the job is the row, and the tables it
   * made are listed underneath as its result.
   */
  const uploads = useMemo(() => {
    const tablesOf = new Map<string, typeof sessionFiles>();
    for (const file of sessionFiles) {
      const key = file.origin_filename || file.original_filename;
      if (!tablesOf.has(key)) tablesOf.set(key, []);
      tablesOf.get(key)!.push(file);
    }
    const rows: {
      filename: string;
      job: (typeof jobs)[number] | undefined;
      tables: typeof sessionFiles;
      size: number;
    }[] = jobs.map((job) => ({
      filename: job.filename,
      job,
      tables: tablesOf.get(job.filename) ?? [],
      size: job.file_size_bytes,
    }));
    // A file imported before this queue existed has tables but no job; it
    // still belongs on the list rather than disappearing from the screen.
    for (const [filename, tables] of tablesOf) {
      if (!rows.some((row) => row.filename === filename)) {
        rows.push({
          filename,
          job: undefined,
          tables,
          size: tables[0]?.file_size_bytes ?? 0,
        });
      }
    }
    return rows;
  }, [jobs, sessionFiles]);

  const working = !!report?.is_working;
  const waitingToStart = (report?.waiting ?? 0) + (report?.failed ?? 0);

  // Progress belongs to the jobs now, and the query polls itself while any of
  // them is working, so this screen keeps no clock of its own.

  // ── File selection ──
  const handleAttachClick = () => fileInputRef.current?.click();

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!LIMITS.ACCEPTED_TYPES.includes(ext as typeof LIMITS.ACCEPTED_TYPES[number])) {
      return `Unsupported file type "${ext}". Please upload a CSV or Excel file (.csv, .xlsx).`;
    }
    if (file.size > LIMITS.MAX_FILE_SIZE_BYTES) {
      return `File is too large (${formatBytes(file.size)}). Maximum allowed size is ${LIMITS.MAX_FILE_SIZE_LABEL}.`;
    }
    if (file.size === 0) {
      return "The selected file is empty. Please choose a valid file.";
    }
    return null;
  };

  /**
   * Hand every chosen file to the server, together.
   *
   * These used to go one at a time, because each upload parsed a whole file
   * and moved the session's active table as it went — racing them left the
   * session pointing at whichever finished last. An upload now only stores
   * bytes and writes down a job, so there is nothing to race: five files go up
   * at once and the reading of them happens later, in the workers.
   */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setFileError(null);

    const accepted: File[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const err = validateFile(file);
      if (err) failures.push(err);
      else accepted.push(file);
    }

    if (accepted.length) {
      // Returns only what failed; the rows themselves appeared the moment the
      // files were chosen, and each one carries its own error.
      const rejected = await uploads_.uploadAll(accepted);
      for (const failure of rejected) {
        failures.push(`${failure.filename}: ${failure.error}`);
      }
    }

    // Cleared so choosing the same file twice in a row still fires a change.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (failures.length) setFileError(failures.join(" · "));
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles([...(event.target.files ?? [])]);
  };

  // ── Drag-and-drop ──
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    await uploadFiles([...(e.dataTransfer.files ?? [])]);
  };

  /**
   * Start reading every file this session is holding.
   *
   * One press covers the whole upload — including anything that failed last
   * time, which is what "start import" means to the person who pressed it.
   * The request returns as soon as the work is handed over; the rows below
   * follow the jobs from there.
   */
  const handleStartImport = async () => {
    setFileError(null);
    setIsImporting(true);
    try {
      await vm.runImportMutation.mutateAsync();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFileError(detail ?? (err instanceof Error ? err.message : "Could not start the import."));
    } finally {
      setIsImporting(false);
    }
  };


  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 1.75, p: 2.5 }}>

        {/* Header */}
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <CloudUploadOutlinedIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={700}>Import Data</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            CSV or Excel, max {LIMITS.MAX_FILE_SIZE_LABEL} each · add as many files as the session needs
            {sessionFiles.length > 0 && ` · ${sessionFiles.length} here now`}
          </Typography>
        </Box>

        {/* File error */}
        {fileError && (
          <Alert severity="error" onClose={() => setFileError(null)} sx={{ py: 0.5 }}>
            {fileError}
          </Alert>
        )}

        {/* Hidden file input — always mounted so the ref stays valid. */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          style={{ display: "none" }}
          accept={LIMITS.ACCEPTED_TYPES.join(",")}
          onChange={handleFileChange}
        />

        {/* Dropping files is the whole of this step, so the target never goes
            away: adding a second file is the same gesture as the first. */}
        <Box
          onClick={handleAttachClick}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          sx={{
            border: "1px dashed",
            borderColor: isDragOver ? "primary.main" : "divider",
            borderRadius: 2,
            p: uploads.length > 0 ? 1.5 : 2.5,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            bgcolor: isDragOver ? "primary.50" : "background.default",
            transition: "all 0.15s",
            "&:hover": { bgcolor: "action.hover", borderColor: "primary.light" },
          }}
        >
          {uploading ? (
            <Box sx={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
              <Typography variant="body2" fontWeight={600}>
                Uploading {uploads_.uploadingCount} file
                {uploads_.uploadingCount === 1 ? "" : "s"}…
              </Typography>
              <LinearProgress
                variant="determinate"
                value={uploads_.overallPercent}
                sx={{ height: 6, borderRadius: 3, my: 0.75 }}
              />
              <Typography variant="caption" color="text.secondary">
                {formatBytes(uploads_.sentBytes)} of {formatBytes(uploads_.totalBytes)} ·{" "}
                {uploads_.overallPercent}%
              </Typography>
            </Box>
          ) : (
            <>
              <CloudUploadOutlinedIcon
                sx={{ fontSize: uploads.length > 0 ? 20 : 30, color: "text.disabled", mb: 0.25 }}
              />
              <Typography variant="body2" fontWeight={600}>
                {uploads.length > 0 ? "Add more files" : "Drop your files here"}
              </Typography>
              <Typography variant="caption" color="primary">
                or click to browse — several at once is fine
              </Typography>
            </>
          )}
        </Box>

        {/* The files of this session, each with the job reading it.
            This step talks in files, not tables: a file is what the person
            chose, and it is what they look for when they want one gone. The
            job's stage and bar say what is happening to it right now; the
            tables it produced are listed underneath once there are any. */}
        {(uploads.length > 0 || uploads_.pending.length > 0) && (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
            <Stack
              direction="row" alignItems="center" spacing={1}
              sx={{ px: 1.5, py: 0.75, bgcolor: "action.hover" }}
            >
              <Typography variant="caption" fontWeight={700}>
                {uploads.length + uploads_.pending.length} file
                {uploads.length + uploads_.pending.length === 1 ? "" : "s"}
                {uploads_.isUploading ? "" : " uploaded"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                · {sessionFiles.length} table{sessionFiles.length === 1 ? "" : "s"} in total
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              {working && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <CircularProgress size={11} />
                  <Typography variant="caption" color="text.secondary">
                    {report?.running} of {uploads.length} being read
                  </Typography>
                </Stack>
              )}
            </Stack>

            <Box sx={{ maxHeight: 300, overflowY: "auto" }}>
              {/* Still on their way. Listed first and in full from the moment
                  the files were chosen, so a four-file drop reads as four
                  files immediately rather than appearing two at a time. */}
              {uploads_.pending.map((row) => (
                <Stack
                  key={row.id}
                  direction="row"
                  alignItems="flex-start"
                  spacing={1.25}
                  sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}
                >
                  {row.status === "failed" ? (
                    <ErrorOutlineIcon fontSize="small" color="error" sx={{ mt: 0.25 }} />
                  ) : (
                    <CloudUploadOutlinedIcon fontSize="small" color="primary" sx={{ mt: 0.25 }} />
                  )}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
                      <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 240 }}>
                        {row.filename}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatBytes(row.size)}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="caption"
                      color={row.status === "failed" ? "error.main" : "text.secondary"}
                      sx={{ display: "block", mt: 0.25 }}
                    >
                      {row.status === "failed"
                        ? row.error
                        : row.percent < 0
                          ? "Uploading…"
                          : `Uploading — ${row.percent}% of ${formatBytes(row.size)}`}
                    </Typography>
                    {row.status === "uploading" && (
                      <LinearProgress
                        // A proxy that strips the content length leaves nothing
                        // to measure; a moving bar is honest, a 0% one is not.
                        variant={row.percent < 0 ? "indeterminate" : "determinate"}
                        value={Math.max(0, row.percent)}
                        sx={{ height: 4, borderRadius: 2, mt: 0.6 }}
                      />
                    )}
                  </Box>
                  {row.status === "failed" && (
                    <Tooltip title="Dismiss">
                      <IconButton size="small" onClick={() => uploads_.dismiss(row.id)} sx={{ p: 0.35 }}>
                        <CloseIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              ))}

              {uploads.map((upload) => {
                const job = upload.job;
                const removing =
                  vm.removeUploadMutation.isPending &&
                  vm.removeUploadMutation.variables === upload.filename;
                const busy = job?.status === "running" || job?.status === "queued";
                const rows = upload.tables.reduce((sum, t) => sum + (t.row_count ?? 0), 0);
                return (
                  <Stack
                    key={upload.filename}
                    direction="row"
                    alignItems="flex-start"
                    spacing={1.25}
                    sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}
                  >
                    <JobIcon status={job?.status} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 240 }}>
                          {upload.filename}
                        </Typography>
                        {upload.tables.length > 0 && (
                          <Chip
                            size="small"
                            label={`${upload.tables.length} table${upload.tables.length === 1 ? "" : "s"}`}
                            color={upload.tables.length > 1 ? "primary" : "default"}
                            variant="outlined"
                            sx={{ height: 18, fontSize: "0.62rem" }}
                          />
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(upload.size)}
                          {rows > 0 && ` · ${rows.toLocaleString()} rows`}
                        </Typography>
                      </Stack>

                      {/* What is happening to this file, in its own words. */}
                      <Typography
                        variant="caption"
                        color={job?.status === "failed" ? "error.main" : "text.secondary"}
                        sx={{ display: "block", mt: 0.25 }}
                      >
                        {describe(job, upload.tables)}
                      </Typography>

                      {busy && (
                        <LinearProgress
                          variant={job?.status === "queued" ? "indeterminate" : "determinate"}
                          value={job?.progress ?? 0}
                          sx={{ height: 4, borderRadius: 2, mt: 0.6 }}
                        />
                      )}
                      {/* A file that imported but could not be profiled is not
                          a failure of the import, so it is said quietly. */}
                      {job?.status === "succeeded" && job.message && (
                        <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                          {job.message}
                        </Typography>
                      )}
                      {/* Where each table came from: Application → table.
                          Per table, because the sheets of one workbook can
                          come from different systems; never read from the
                          file name. */}
                      {upload.tables.map((table) =>
                        upload.tables.length > 1 ? (
                          <Box key={table.source_file_id} sx={{ pl: 1, mt: 0.5, borderLeft: 2, borderColor: "divider" }}>
                            <Typography variant="caption" fontWeight={600} sx={{ display: "block" }}>
                              {table.sheet_name || table.original_filename}
                            </Typography>
                            <SourceApplicationLine vm={vm} sourceFileId={table.source_file_id} tableName={table.original_filename} />
                          </Box>
                        ) : (
                          <SourceApplicationLine
                            key={table.source_file_id}
                            vm={vm}
                            sourceFileId={table.source_file_id}
                            tableName={table.original_filename}
                          />
                        ),
                      )}
                    </Box>
                    <Tooltip title={`Remove ${upload.filename}`}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={removing || busy}
                          onClick={() => vm.removeUploadMutation.mutate(upload.filename)}
                          sx={{ p: 0.35 }}
                        >
                          {removing ? <CircularProgress size={13} /> : <CloseIcon sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Box>
          </Box>
        )}

        {report && report.failed > 0 && !working && (
          <Alert severity="warning" sx={{ py: 0.5 }}>
            {report.failed} file{report.failed === 1 ? "" : "s"} could not be read. Fix or remove
            {report.failed === 1 ? " it" : " them"}, then press Start import again — the files that
            worked are already in.
          </Alert>
        )}

        {/* One press for the whole upload: reading five files is one decision,
            not five. It stays available while files are still being added. */}
        <Box sx={{ mt: "auto", pt: 0.5 }}>
          {uploading ? (
            /* No Start import while files are still arriving: pressing it
               would queue the ones that had landed and quietly leave the rest
               out of the run. */
            <Box sx={{ textAlign: "center", py: 0.5 }}>
              <LinearProgress
                variant="determinate"
                value={uploads_.overallPercent}
                sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
              />
              <Typography variant="caption" color="text.secondary">
                Uploading {uploads_.uploadingCount} file
                {uploads_.uploadingCount === 1 ? "" : "s"} — {uploads_.overallPercent}%. Start
                import appears when every file has arrived.
              </Typography>
            </Box>
          ) : (
          <Button
            fullWidth
            variant="contained"
            color="primary"
            startIcon={
              isImporting || working
                ? <CircularProgress size={16} color="inherit" />
                : <PlayArrowIcon />
            }
            sx={{ py: 0.75, textTransform: "none", fontWeight: 600 }}
            onClick={handleStartImport}
            disabled={isImporting || working || waitingToStart === 0}
          >
            {working
              ? `Reading ${report?.running ?? 0} file${report?.running === 1 ? "" : "s"}…`
              : waitingToStart > 0
                ? `Start import — ${waitingToStart} file${waitingToStart === 1 ? "" : "s"}`
                : uploads.length > 0
                  ? "Everything is imported"
                  : "Start import"}
          </Button>
          )}
          {report && report.succeeded > 0 && !working && waitingToStart === 0 && (
            <Typography
              variant="caption"
              color="success.main"
              sx={{ display: "block", textAlign: "center", mt: 0.75 }}
            >
              {report.tables_created} table{report.tables_created === 1 ? "" : "s"} ready — continue
              to Profile Data.
            </Typography>
          )}
        </Box>

      </CardContent>
    </Card>
  );
}
