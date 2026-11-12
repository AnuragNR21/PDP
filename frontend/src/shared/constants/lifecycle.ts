/**
 * Lifecycle labels: Draft → Active → Archived. The third state is stored as
 * "retired" (MWS definitions and SWS instances alike) and shown as "Archived".
 */
const LABEL: Record<string, string> = { draft: "Draft", active: "Active", retired: "Archived" };

export function lifecycleLabel(status: string | null | undefined) {
  if (!status) return "";
  return LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}
