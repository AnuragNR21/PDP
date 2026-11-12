import { apiClient } from "@/shared/http/apiClient";
import type { SearchResponse } from "../domain/globalSearch";

export const searchApi = {
  /** Server-side search across PDP; nothing is loaded into the browser to search it. */
  search: (params: { q: string; types?: string[]; status?: string; limit?: number }, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ q: params.q });
    if (params.types && params.types.length > 0) qs.set("types", params.types.join(","));
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    return apiClient.get<SearchResponse>(`/api/search?${qs.toString()}`, signal);
  },
};
