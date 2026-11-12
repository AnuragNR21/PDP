import { apiClient } from "@/shared/http/apiClient";
import type {
  GovernanceEdge,
  GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

export type GovernanceItemSearchReport = {
  items: GovernanceItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export type GovernanceGraphReport = {
  items: GovernanceItem[];
  edges: GovernanceEdge[];
  truncated: boolean;
  total: number;
  limit: number;
  seed_ids: string[];
  message?: string;
};

export type GovernanceItemsReport = {
  items: GovernanceItem[];
  edges: GovernanceEdge[];
  /** Ids a saved diagram named that the graph no longer holds. */
  missing_ids: string[];
};

/**
 * Reads of the structure governance graph.
 *
 * Every call is a read. Searching happens on the server because the catalogue
 * runs to tens of thousands of rows, and a picker that downloads all of them to
 * filter in the browser is a picker nobody waits for.
 */
export const structureGovernanceGraphApi = {
  searchItems: (params: {
    search?: string;
    kind?: string;
    modelId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.kind) query.set("kind", params.kind);
    if (params.modelId) query.set("model_id", params.modelId);
    query.set("limit", String(params.limit ?? 50));
    query.set("offset", String(params.offset ?? 0));
    return apiClient.get<GovernanceItemSearchReport>(
      `/api/structure/governance-graph/items?${query.toString()}`,
    );
  },

  getItems: (itemIds: string[]) =>
    apiClient.post<GovernanceItemsReport>("/api/structure/governance-graph/items", {
      item_ids: itemIds,
    }),

  neighbourhood: (itemIds: string[], depth: number) =>
    apiClient.post<GovernanceGraphReport>("/api/structure/governance-graph/neighbourhood", {
      item_ids: itemIds,
      depth,
    }),
};
