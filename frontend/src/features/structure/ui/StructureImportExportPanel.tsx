import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import type {
  StructureImportCommitResponse,
  StructureImportPayload,
  StructureImportValidateResponse,
} from "@/features/structure/api/structureApi";
import { structureApi } from "@/features/structure/api/structureApi";
import { useHierarchyModels, useSupportDomainModels } from "@/features/structure/state/useStructureWorkspace";
import { ExportOptionsDialog } from "@/features/structure/ui/ExportOptionsDialog";
import { ImportOptionsDialog } from "@/features/structure/ui/ImportOptionsDialog";
import { columnsForImport, ImportReviewGrid } from "@/features/structure/ui/ImportReviewGrid";

const ALL_CSV_COLUMNS = [
  "object_type",
  "action",
  "pdp_system_id",
  "external_id",
  "model_id",
  "model_name",
  "node_type_id",
  "name",
  "description",
  "parent_pdp_system_id",
  "parent_external_id",
  "parent_name",
  "support_domain_model_id",
  "element_type_id",
  "relationship_rule_id",
  "source_instance_type",
  "source_pdp_system_id",
  "source_external_id",
  "target_instance_type",
  "target_pdp_system_id",
  "target_external_id",
  "relationship_type_id",
  "relationship_name",
  "source_element_type_id",
  "source_instance_id",
  "source_instance_name",
  "target_element_type_id",
  "target_instance_id",
  "target_instance_name",
] as const;

const HIERARCHY_CSV_COLUMNS = [
  "object_type",
  "action",
  "pdp_system_id",
  "external_id",
  "model_id",
  "model_name",
  "node_type_id",
  "name",
  "description",
  "parent_pdp_system_id",
  "parent_external_id",
  "parent_name",
] as const;

const SUPPORT_DOMAIN_CSV_COLUMNS = [
  "object_type",
  "action",
  "pdp_system_id",
  "external_id",
  "support_domain_model_id",
  "model_name",
  "element_type_id",
  "name",
  "description",
  // Relationship rows (object_type support_domain_model_element_instance_relationship).
  // IDs are authoritative; the names are there so the file can be read.
  "relationship_type_id",
  "relationship_name",
  "source_element_type_id",
  "source_instance_id",
  "source_instance_name",
  "target_element_type_id",
  "target_instance_id",
  "target_instance_name",
] as const;

/**
 * A link drawn between two SD element instances on the SWS diagram (diagram-only,
 * support_domain_element_instance_relationship_diagram_edges), in the same CSV as the instances. Support Domain
 * relationships themselves are inherited from the model and are not in this file.
 */
const SD_INSTANCE_RELATIONSHIP_OBJECT = "support_domain_model_element_instance_relationship";

// Temporarily disabled while SD element relationship import/export is under internal testing.
// Flip to true (and restore the "sd-relationships" option in ImportOptionsDialog) to re-enable.
const SD_RELATIONSHIPS_EXPORT_ENABLED = false;

const SUPPORT_DOMAIN_RELATIONSHIP_CSV_COLUMNS = [
  "object_type",
  "action",
  "support_domain_model_id",
  "model_name",
  "source_element_type_id",
  "source_element_type_name",
  "target_element_type_id",
  "target_element_type_name",
  "relationship_type",
] as const;

type ImportScope = "hierarchy" | "sd-elements" | "sd-relationships";

type ImportState = {
  selectedFileName: string | null;
  payload: StructureImportPayload | null;
  validateResult: StructureImportValidateResponse | null;
  commitResult: StructureImportCommitResponse | null;
  error: string | null;
  isValidating: boolean;
  isCommitting: boolean;
};

type CsvTemplateType = "all" | "hierarchy" | "support-domain";

type SelectedRowsByScope = Record<ImportScope, Set<number>>;

type FullTextDialogState = {
  open: boolean;
  title: string;
  value: string;
};

function emptyImportState(): ImportState {
  return {
    selectedFileName: null,
    payload: null,
    validateResult: null,
    commitResult: null,
    error: null,
    isValidating: false,
    isCommitting: false,
  };
}

function safeParseTemplateJson(text: string): StructureImportPayload {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return {
    template_metadata: (parsed.Template_Metadata as Record<string, unknown>) ?? {},
    load_hierarchy_node_instances:
      (parsed.Load_Hierarchy_Node_Instances as Record<string, unknown>[]) ??
      (parsed.load_hierarchy_node_instances as Record<string, unknown>[]) ??
      [],
    load_support_domain_elements:
      (parsed.Load_Support_Domain_Elements as Record<string, unknown>[]) ??
      (parsed.load_support_domain_elements as Record<string, unknown>[]) ??
      [],
    load_support_domain_element_relationships:
      (parsed.Load_Support_Domain_Element_Relationships as Record<string, unknown>[]) ??
      (parsed.load_support_domain_element_relationships as Record<string, unknown>[]) ??
      [],
    load_support_domain_relationships:
      (parsed.Load_Support_Domain_Relationships as Record<string, unknown>[]) ??
      (parsed.load_support_domain_relationships as Record<string, unknown>[]) ??
      [],
    load_support_domain_element_instance_relationships:
      (parsed.Load_Support_Domain_Element_Instance_Relationships as Record<string, unknown>[]) ??
      (parsed.load_support_domain_element_instance_relationships as Record<string, unknown>[]) ??
      [],
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function normalizeRow(row: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      normalized[key] = trimmed;
    }
  }
  return normalized;
}

function safeParseTemplateCsv(text: string): StructureImportPayload {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return {
      template_metadata: {},
      load_hierarchy_node_instances: [],
      load_support_domain_elements: [],
      load_support_domain_element_relationships: [],
      load_support_domain_relationships: [],
      load_support_domain_element_instance_relationships: [],
    };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const records = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });

  const hierarchyRows: Record<string, unknown>[] = [];
  const supportRows: Record<string, unknown>[] = [];
  const supportElementRelationshipRows: Record<string, unknown>[] = [];
  const relationshipRows: Record<string, unknown>[] = [];
  const sdInstanceRelationshipRows: Record<string, unknown>[] = [];

  for (const record of records) {
    const objectType = (record.object_type || "").trim();
    const payloadRow = normalizeRow(record);
    delete payloadRow.object_type;

    if (objectType === "hierarchy_model_node_instance") {
      hierarchyRows.push(payloadRow);
      continue;
    }
    if (objectType === "support_domain_model_element_instance") {
      supportRows.push(payloadRow);
      continue;
    }
    if (objectType === SD_INSTANCE_RELATIONSHIP_OBJECT) {
      sdInstanceRelationshipRows.push(payloadRow);
      continue;
    }
    if (objectType === "support_domain_element_relationship") {
      supportElementRelationshipRows.push(payloadRow);
    }
  }

  return {
    template_metadata: { format: "csv" },
    load_hierarchy_node_instances: hierarchyRows,
    load_support_domain_elements: supportRows,
    load_support_domain_element_relationships: supportElementRelationshipRows,
    load_support_domain_relationships: relationshipRows,
    load_support_domain_element_instance_relationships: sdInstanceRelationshipRows,
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (!/[",\n\r]/.test(str)) {
    return str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function buildCsvRows(data: Record<string, unknown>, templateType: CsvTemplateType): Record<string, unknown>[] {
  const hierarchy = (data.Load_Hierarchy_Node_Instances as Record<string, unknown>[] | undefined) ?? [];
  const support = (data.Load_Support_Domain_Elements as Record<string, unknown>[] | undefined) ?? [];
  const relationships = (data.Load_Support_Domain_Relationships as Record<string, unknown>[] | undefined) ?? [];
  // Instances first, then the links between them: the import processes them in that order.
  const sdLinks = (
    (data.Load_Support_Domain_Element_Instance_Relationships as Record<string, unknown>[] | undefined) ?? []
  ).map((row) => ({ object_type: SD_INSTANCE_RELATIONSHIP_OBJECT, ...row }));

  if (templateType === "hierarchy") {
    return hierarchy.map((row) => ({ object_type: "hierarchy_model_node_instance", ...row }));
  }
  if (templateType === "support-domain") {
    return [...support.map((row) => ({ object_type: "support_domain_model_element_instance", ...row })), ...sdLinks];
  }

  return [
    ...hierarchy.map((row) => ({ object_type: "hierarchy_model_node_instance", ...row })),
    ...support.map((row) => ({ object_type: "support_domain_model_element_instance", ...row })),
    ...sdLinks,
    ...relationships.map((row) => ({ object_type: "support_domain_relationship_instance", ...row })),
  ];
}

function csvColumnsForTemplateType(templateType: CsvTemplateType) {
  if (templateType === "hierarchy") {
    return HIERARCHY_CSV_COLUMNS;
  }
  if (templateType === "support-domain") {
    return SUPPORT_DOMAIN_CSV_COLUMNS;
  }
  return ALL_CSV_COLUMNS;
}

function toCsvTextWithColumns(rows: Record<string, unknown>[], columns: readonly string[]): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...lines].join("\n");
}

function toCsvText(rows: Record<string, unknown>[], templateType: CsvTemplateType): string {
  return toCsvTextWithColumns(rows, csvColumnsForTemplateType(templateType));
}

function buildSupportDomainRelationshipRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const relationships =
    (data.Load_Support_Domain_Element_Relationships as Record<string, unknown>[] | undefined) ?? [];
  return relationships.map((row) => ({ object_type: "support_domain_element_relationship", ...row }));
}

function importedRowsForScope(state: ImportState, scope: ImportScope): Record<string, unknown>[] {
  if (!state.payload) {
    return [];
  }

  if (scope === "hierarchy") {
    return (state.payload.load_hierarchy_node_instances ?? []).map((row) => ({
      object_type: "hierarchy_model_node_instance",
      ...row,
    }));
  }

  if (scope === "sd-relationships") {
    return (state.payload.load_support_domain_element_relationships ?? []).map((row) => ({
      object_type: "support_domain_element_relationship",
      ...row,
    }));
  }

  // The server numbers relationship rows after the instance rows, in this same order.
  return [
    ...(state.payload.load_support_domain_elements ?? []).map((row) => ({
      object_type: "support_domain_model_element_instance",
      ...row,
    })),
    ...(state.payload.load_support_domain_element_instance_relationships ?? []).map((row) => ({
      object_type: SD_INSTANCE_RELATIONSHIP_OBJECT,
      ...row,
    })),
  ];
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // `click()` only *starts* the download; the browser reads the blob URL
  // afterwards. Revoking it on this tick pulls the bytes out from under that
  // read, and an empty file lands on disk looking like a successful export.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** One exported data type, as the CSV file the Import step reads back. */
function downloadCsvFile(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/csv;charset=utf-8" }));
}

function filterPayloadForScope(payload: StructureImportPayload, scope: ImportScope): StructureImportPayload {
  const base: StructureImportPayload = {
    template_metadata: payload.template_metadata ?? {},
    load_hierarchy_node_instances: [],
    load_support_domain_elements: [],
    load_support_domain_element_relationships: [],
    load_support_domain_relationships: [],
    load_support_domain_element_instance_relationships: [],
  };

  if (scope === "hierarchy") {
    return { ...base, load_hierarchy_node_instances: payload.load_hierarchy_node_instances ?? [] };
  }

  if (scope === "sd-relationships") {
    return {
      ...base,
      load_support_domain_element_relationships: payload.load_support_domain_element_relationships ?? [],
    };
  }

  return {
    ...base,
    load_support_domain_elements: payload.load_support_domain_elements ?? [],
    load_support_domain_element_instance_relationships: payload.load_support_domain_element_instance_relationships ?? [],
  };
}

function scopeLabel(scope: ImportScope): string {
  if (scope === "hierarchy") {
    return "Hierarchy Node Instances";
  }
  if (scope === "sd-relationships") {
    return "SD Element Relationships";
  }
  return "SD Element Instances & Diagram Links";
}

function selectedAcceptedCount(rows: StructureImportValidateResponse["rows"], selectedRowNumbers: Set<number>): number {
  return rows.filter((row) => row.status === "accepted" && selectedRowNumbers.has(row.row_number)).length;
}

export function StructureImportExportPanel() {
  const [importByScope, setImportByScope] = useState<Record<ImportScope, ImportState>>({
    hierarchy: emptyImportState(),
    "sd-elements": emptyImportState(),
    "sd-relationships": emptyImportState(),
  });
  const [selectedRowsByScope, setSelectedRowsByScope] = useState<SelectedRowsByScope>({
    hierarchy: new Set<number>(),
    "sd-elements": new Set<number>(),
    "sd-relationships": new Set<number>(),
  });

  const makeSetImportState =
    (scope: ImportScope) => (updater: (prev: ImportState) => ImportState) =>
      setImportByScope((prev) => ({ ...prev, [scope]: updater(prev[scope]) }));
  const [fullTextDialog, setFullTextDialog] = useState<FullTextDialogState>({
    open: false,
    title: "",
    value: "",
  });
  const [activeScope, setActiveScope] = useState<ImportScope>("hierarchy");
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const queryClient = useQueryClient();
  const hierarchyModelsQuery = useHierarchyModels();
  const supportDomainModelsQuery = useSupportDomainModels();
  const exportHierarchyModels = useMemo(
    () => (hierarchyModelsQuery.data ?? []).map((model) => ({ id: model.id, name: model.name, status: model.status })),
    [hierarchyModelsQuery.data],
  );
  const exportSupportDomainModels = useMemo(
    () => (supportDomainModelsQuery.data ?? []).map((model) => ({ id: model.id, name: model.name, status: model.status })),
    [supportDomainModelsQuery.data],
  );

  const activeImport = importByScope[activeScope];
  const activeRows = activeImport.validateResult?.rows ?? [];
  const activeImportedRows = importedRowsForScope(activeImport, activeScope);
  const activeSelectedRows = selectedRowsByScope[activeScope];
  const activeSelectedAcceptedCount = selectedAcceptedCount(activeRows, activeSelectedRows);
  const activeHasLinks = activeRows.some((row) => row.object_type === SD_INSTANCE_RELATIONSHIP_OBJECT);
  const activeColumns = useMemo(() => columnsForImport(activeScope, activeHasLinks), [activeScope, activeHasLinks]);

  function setSelectedRows(scope: ImportScope, next: Set<number>) {
    setSelectedRowsByScope((prev) => ({
      ...prev,
      [scope]: next,
    }));
  }

  function handleShowFullText(title: string, value: string) {
    setFullTextDialog({
      open: true,
      title,
      value,
    });
  }

  function handleCloseFullText() {
    setFullTextDialog({
      open: false,
      title: "",
      value: "",
    });
  }

  async function loadImportFile(scope: ImportScope, file: File) {
    const setState = makeSetImportState(scope);
    setState((prev) => ({ ...prev, error: null, validateResult: null, commitResult: null }));

    try {
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv");
      const parsed = isCsv ? safeParseTemplateCsv(text) : safeParseTemplateJson(text);
      const filtered = filterPayloadForScope(parsed, scope);
      setState((prev) => ({ ...prev, payload: filtered, selectedFileName: file.name }));
      setSelectedRows(scope, new Set<number>());
      setActiveScope(scope);
    } catch {
      setState((prev) => ({
        ...prev,
        payload: null,
        selectedFileName: file.name,
        error: "Could not parse file. Upload a CSV template with required object_type/action columns.",
      }));
      setSelectedRows(scope, new Set<number>());
    }
  }

  async function handleValidate(scope: ImportScope) {
    const state = importByScope[scope];
    const setState = makeSetImportState(scope);

    if (!state.payload) {
      setState((prev) => ({ ...prev, error: `Upload ${scopeLabel(scope)} template before validating.` }));
      return;
    }

    setState((prev) => ({ ...prev, error: null, commitResult: null, isValidating: true }));
    try {
      let result: StructureImportValidateResponse;
      if (scope === "hierarchy") {
        result = await structureApi.validateHierarchyImport(state.payload);
      } else if (scope === "sd-relationships") {
        result = await structureApi.validateSupportDomainRelationshipImport(state.payload);
      } else {
        result = await structureApi.validateSupportDomainImport(state.payload);
      }
      setState((prev) => ({ ...prev, validateResult: result }));
      setSelectedRows(
        scope,
        new Set(result.rows.filter((row) => row.status === "accepted").map((row) => row.row_number)),
      );
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setState((prev) => ({ ...prev, error: detail ?? "Validation failed." }));
    } finally {
      setState((prev) => ({ ...prev, isValidating: false }));
    }
  }

  async function handleCommit(scope: ImportScope) {
    const state = importByScope[scope];
    const setState = makeSetImportState(scope);

    if (!state.validateResult?.stage_id) {
      setState((prev) => ({ ...prev, error: "Run validation first." }));
      return;
    }

    setState((prev) => ({ ...prev, error: null, isCommitting: true }));
    try {
      // Only rows that are both accepted by validation and selected by the user.
      const accepted = new Set(
        (state.validateResult.rows ?? []).filter((row) => row.status === "accepted").map((row) => row.row_number),
      );
      const selectedRowNumbers = Array.from(selectedRowsByScope[scope]).filter((rowNumber) => accepted.has(rowNumber));
      const stageId = state.validateResult.stage_id;
      let result: StructureImportCommitResponse;
      if (scope === "hierarchy") {
        result = await structureApi.commitHierarchyImport(stageId, selectedRowNumbers);
      } else if (scope === "sd-relationships") {
        result = await structureApi.commitSupportDomainRelationshipImport(stageId, selectedRowNumbers);
      } else {
        result = await structureApi.commitSupportDomainImport(stageId, selectedRowNumbers);
      }
      setState((prev) => ({ ...prev, commitResult: result }));
      // Committed instances and relationships show at once in the Matrix, Diagram and List.
      if (result.committed > 0) void queryClient.invalidateQueries();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setState((prev) => ({ ...prev, error: detail ?? "Commit failed." }));
    } finally {
      setState((prev) => ({ ...prev, isCommitting: false }));
    }
  }

  async function handleExport(hierarchyModelIds: string[], supportDomainModelIds: string[]) {
    setIsExporting(true);
    setExportError(null);
    try {
      const modelIds = [...hierarchyModelIds, ...supportDomainModelIds];
      const data = await structureApi.exportStructureData("all", modelIds);

      const files: { name: string; content: string }[] = [];

      // Only produce a file per data type when the selection includes matching
      // models and that section actually has rows, so at most three CSVs are
      // written and none of them is empty.
      if (hierarchyModelIds.length > 0) {
        const hierarchyRows = buildCsvRows(data, "hierarchy");
        if (hierarchyRows.length > 0) {
          files.push({
            name: "exported_hierarchy_node_instances.csv",
            content: toCsvText(hierarchyRows, "hierarchy"),
          });
        }
      }

      if (supportDomainModelIds.length > 0) {
        const elementRows = buildCsvRows(data, "support-domain");
        if (elementRows.length > 0) {
          files.push({
            name: "exported_support_domain_element_instances.csv",
            content: toCsvText(elementRows, "support-domain"),
          });
        }
        if (SD_RELATIONSHIPS_EXPORT_ENABLED) {
          const relationshipRows = buildSupportDomainRelationshipRows(data);
          if (relationshipRows.length > 0) {
            files.push({
              name: "exported_support_domain_element_relationships.csv",
              content: toCsvTextWithColumns(relationshipRows, SUPPORT_DOMAIN_RELATIONSHIP_CSV_COLUMNS),
            });
          }
        }
      }

      if (files.length === 0) {
        setExportError("The selected models contain no data to export.");
        return;
      }

      // Each data type is downloaded as its own CSV. No archive: the file that
      // lands is the file the Import step takes, with nothing to unzip first.
      files.forEach((file, index) => {
        // A browser drops downloads fired in the same tick as one another, so
        // several are spaced out. The usual case is one file and goes at once.
        if (index === 0) {
          downloadCsvFile(file.name, file.content);
          return;
        }
        window.setTimeout(() => downloadCsvFile(file.name, file.content), index * 400);
      });
      setExportDialogOpen(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setExportError(detail ?? "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        height: "100%",
        minWidth: 0,
        p: 2,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <Stack spacing={2} sx={{ minWidth: 0, width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={isExporting ? <CircularProgress size={14} /> : <DownloadOutlinedIcon />}
            onClick={() => {
              setExportError(null);
              setExportDialogOpen(true);
            }}
            disabled={isExporting}
          >
            Export Structure Data
          </Button>
          <Button
            variant="contained"
            startIcon={<UploadFileOutlinedIcon />}
            onClick={() => setImportDialogOpen(true)}
          >
            Import Structure Data
          </Button>
        </Stack>

        <Paper
          variant="outlined"
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            p: 1.5,
            minWidth: 0,
            overflowX: "hidden",
          }}
        >
          <Stack spacing={1.5} sx={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              alignItems={{ xs: "flex-start", md: "center" }}
              justifyContent="space-between"
              sx={{ width: "100%", minWidth: 0 }}
            >
              <Typography variant="subtitle2">DATA IMPORT SUMMARY</Typography>
              {activeImport.selectedFileName && (
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                  {scopeLabel(activeScope)} — {activeImport.selectedFileName}
                </Typography>
              )}
            </Stack>

            {activeImport.payload && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  startIcon={activeImport.isValidating ? <CircularProgress size={14} /> : <RuleOutlinedIcon />}
                  onClick={() => void handleValidate(activeScope)}
                  disabled={!activeImport.payload || activeImport.isValidating}
                >
                  Validate
                </Button>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={activeImport.isCommitting ? <CircularProgress size={14} /> : <SaveOutlinedIcon />}
                  onClick={() => void handleCommit(activeScope)}
                  disabled={!activeImport.validateResult || activeSelectedAcceptedCount === 0 || activeImport.isCommitting}
                >
                  Commit {activeImport.validateResult ? `${activeSelectedAcceptedCount} ` : ""}Accepted Rows
                </Button>
              </Stack>
            )}

            {activeImport.error && <Alert severity="error">{activeImport.error}</Alert>}

            {activeImport.validateResult && (
              <Stack spacing={1} sx={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
                <Typography variant="subtitle2">
                  {activeScope === "hierarchy"
                    ? "Hierarchy Validation Summary"
                    : activeScope === "sd-relationships"
                      ? "SD Relationship Validation Summary"
                      : "SD Validation Summary"}
                </Typography>
              </Stack>
            )}

            {activeImport.commitResult && (
              <Alert severity={activeImport.commitResult.failed > 0 ? "warning" : "success"}>
                Commit finished. Committed {activeImport.commitResult.committed} rows, failed {activeImport.commitResult.failed} rows.
              </Alert>
            )}

            {activeImport.validateResult && (
              <ImportReviewGrid
                key={activeScope}
                layoutKey={activeScope}
                reviewKey={`${activeScope}:${activeImport.selectedFileName ?? ""}`}
                rows={activeRows}
                importedRows={activeImportedRows}
                columns={activeColumns}
                selected={activeSelectedRows}
                onSelectedChange={(next) => setSelectedRows(activeScope, next)}
                onShowFullText={handleShowFullText}
              />
            )}
          </Stack>
        </Paper>

        <ExportOptionsDialog
          open={exportDialogOpen}
          hierarchyModels={exportHierarchyModels}
          supportDomainModels={exportSupportDomainModels}
          isLoadingModels={hierarchyModelsQuery.isLoading || supportDomainModelsQuery.isLoading}
          isExporting={isExporting}
          error={exportError}
          onClose={() => setExportDialogOpen(false)}
          onExport={(hierarchyModelIds, supportDomainModelIds) =>
            void handleExport(hierarchyModelIds, supportDomainModelIds)
          }
        />

        <ImportOptionsDialog
          open={importDialogOpen}
          onClose={() => setImportDialogOpen(false)}
          onConfirm={(scope, file) => {
            setImportDialogOpen(false);
            void loadImportFile(scope, file);
          }}
        />

        <Dialog open={fullTextDialog.open} onClose={handleCloseFullText} fullWidth maxWidth="md">
          <DialogTitle>Show full text - {fullTextDialog.title}</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {fullTextDialog.value}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseFullText} variant="contained">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
  );
}
