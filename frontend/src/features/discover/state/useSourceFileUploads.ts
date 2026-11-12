/**
 * Files on their way to the server, and how far each one has got.
 *
 * The screen used to list uploads by reading the server's job table, so a file
 * only appeared once its whole body had arrived. Dropping four files showed
 * two, paused, then showed four — the two small ones finished first and the
 * big ones were invisible until they landed. On a 100 MB file that is a minute
 * of a screen that looks broken.
 *
 * So the chosen files are held here the moment they are chosen — all of them,
 * at once, before a single byte goes out — and each row's bar is driven by the
 * upload's own progress events. A row hands over to the server's job row only
 * after the list has been refetched, so it is never absent from both.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { discoverApi } from "@/features/discover/api/discoverApi";

export type PendingUpload = {
  /** Local only: two files can share a name, and neither has a server id yet. */
  id: string;
  filename: string;
  size: number;
  sentBytes: number;
  /** -1 when the browser cannot measure it, which the screen shows as a spinner. */
  percent: number;
  status: "uploading" | "failed";
  error?: string;
};

let counter = 0;
const nextId = () => `up_${Date.now().toString(36)}_${(counter += 1)}`;

function messageFrom(reason: unknown): string {
  const detail = (reason as { response?: { data?: { detail?: string; message?: string } } })
    ?.response?.data;
  if (detail?.detail) return detail.detail;
  if (detail?.message) return detail.message;
  if (reason instanceof Error) return reason.message;
  return "could not be uploaded.";
}

export function useSourceFileUploads(
  sessionId: string,
  /** Refetch the server's view. Awaited before a finished row is removed. */
  onUploaded: () => Promise<void> | void
) {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  // The callback changes identity on every render of the parent hook; a ref
  // keeps `uploadAll` stable so it is not rebuilt mid-upload.
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  });

  // Switching sessions abandons the view of these uploads. The requests
  // themselves are left to finish — the bytes are already on their way and the
  // server will have the file — but they no longer belong to this screen.
  useEffect(() => {
    setPending([]);
  }, [sessionId]);

  const patch = useCallback((id: string, change: Partial<PendingUpload>) => {
    setPending((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }, []);

  const uploadAll = useCallback(
    async (files: File[]): Promise<{ filename: string; error: string }[]> => {
      if (files.length === 0 || !sessionId) return [];

      // Every file, listed before anything is sent. This is the fix: the count
      // the person sees is the count they chose, immediately.
      const rows: PendingUpload[] = files.map((file) => ({
        id: nextId(),
        filename: file.name,
        size: file.size,
        sentBytes: 0,
        percent: 0,
        status: "uploading",
      }));
      setPending((current) => [...current, ...rows]);

      const failures: { filename: string; error: string }[] = [];

      await Promise.all(
        files.map(async (file, index) => {
          const row = rows[index];
          try {
            await discoverApi.uploadSourceFile(sessionId, file, (sent, total) => {
              patch(row.id, {
                sentBytes: sent,
                percent: total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : -1,
              });
            });
            // The server knows about it before this row goes, so the file is
            // never missing from the list for a frame.
            await onUploadedRef.current();
            setPending((current) => current.filter((r) => r.id !== row.id));
          } catch (reason) {
            const error = messageFrom(reason);
            failures.push({ filename: file.name, error });
            // Kept on screen: a file that failed silently is a file the person
            // thinks they uploaded.
            patch(row.id, { status: "failed", error, percent: 0 });
          }
        })
      );

      return failures;
    },
    [sessionId, patch]
  );

  const dismiss = useCallback((id: string) => {
    setPending((rows) => rows.filter((row) => row.id !== id));
  }, []);

  const inFlight = pending.filter((row) => row.status === "uploading");
  const totalBytes = inFlight.reduce((sum, row) => sum + row.size, 0);
  const sentBytes = inFlight.reduce((sum, row) => sum + row.sentBytes, 0);

  return {
    pending,
    dismiss,
    uploadAll,
    /** True while any file is still going up — what hides Start import. */
    isUploading: inFlight.length > 0,
    uploadingCount: inFlight.length,
    /** The batch as one number, so a four-file drop reads as one operation. */
    overallPercent: totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0,
    totalBytes,
    sentBytes,
  };
}
