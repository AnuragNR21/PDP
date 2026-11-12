import { apiClient } from "@/shared/http/apiClient";
import type {
  Finding,
  HubLink,
  NotAssessed,
  QualityCheck,
  QualityRun,
  RuleConfiguration,
  SourceMapping,
} from "@/features/impact/domain/impactQualityResults";

export type QualityResults = {
  mappings: SourceMapping[];
  runs: QualityRun[];
  checks: QualityCheck[];
  configurations: RuleConfiguration[];
  references: { reference_id: string; name: string; element_type_name: string | null; model_name: string | null }[];
  /** Properties governance expects checked that no shown run checked. */
  not_assessed: NotAssessed[];
  /** How each hub reaches each relevant property, for tracing a result back. */
  links: HubLink[];
  /** The hub stood for more properties than one read resolves. */
  truncated: boolean;
  /** The run asked for; empty means each dataset's newest. */
  run_id: string;
  /** The runs the shown checks actually came from. */
  run_ids: string[];
  assessed: boolean;
  has_runs: boolean;
  item_ids: string[];
};

export type FindingPageReport = {
  rows: Finding[];
  total: number;
  sampled: boolean;
  has_more: boolean;
  next_offset: number | null;
};

/**
 * What Discover found about the data representing these PDP instances.
 *
 * Read-only by construction: the Impact workspace is a discovery projection
 * and there is no write path here to call by accident.
 */
export const impactQualityResultsApi = {
  qualityResultsFor: (itemIds: string[], runId = "") =>
    apiClient.post<QualityResults>("/api/discover/structure-instances/quality-results", {
      item_ids: itemIds,
      run_id: runId,
    }),

  /** One check's findings, a page at a time — large sets are not fetched whole. */
  findingsFor: (qualityCheckId: string, offset = 0, limit = 50) =>
    apiClient.get<FindingPageReport>(
      `/api/discover/quality-checks/${encodeURIComponent(qualityCheckId)}/findings` +
        `?offset=${offset}&limit=${limit}`,
    ),
};
