import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rulesApi, type SaveRulePayload } from "@/features/rules/api/rulesApi";

/**
 * The Rule Workspace's own state. It reads and writes rule definitions and
 * nothing else, so no other workspace's cache is touched from here.
 */
export function useRulesWorkspace() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const filters = useMemo(() => ({ search, status, category }), [search, status, category]);

  const catalogueQuery = useQuery({
    queryKey: ["rules", "catalogue"],
    queryFn: () => rulesApi.getCatalogue(),
    staleTime: 10 * 60_000,
  });

  const rulesQuery = useQuery({
    queryKey: ["rules", "list", filters],
    queryFn: () => rulesApi.listRules(filters),
    // Keeps the table on screen while a filter change is in flight, so the
    // list never blinks to empty and back.
    placeholderData: keepPreviousData,
    // The library is shared, so a tab left open goes stale: someone else edits
    // or removes a rule and this table still offers it. The app turns focus
    // refetching off globally; the rule library asks for it back, because
    // acting on a row that no longer exists is the failure it causes.
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ["rules", "list"] });

  /**
   * A 404 means the row came from a stale list: the rule is already gone.
   * Refresh so the row disappears instead of staying there to be clicked again.
   */
  const isMissing = (err: unknown) => (err as { status?: number })?.status === 404;
  const onErrorRefresh = (err: unknown) => {
    if (isMissing(err)) refreshList();
  };

  // Checking a script is a read: it never saves and never runs anything, so it
  // is a mutation only in the sense that the editor asks for it on demand.
  const validateScriptMutation = useMutation({
    mutationFn: (script: string) => rulesApi.validateScript(script),
  });

  const testExamplesMutation = useMutation({
    mutationFn: (payload: Parameters<typeof rulesApi.testExamples>[0]) => rulesApi.testExamples(payload),
  });

  const createRuleMutation = useMutation({
    mutationFn: (payload: SaveRulePayload) => rulesApi.createRule(payload),
    onSuccess: refreshList,
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ ruleDefinitionId, payload }: { ruleDefinitionId: string; payload: SaveRulePayload }) =>
      rulesApi.updateRule(ruleDefinitionId, payload),
    onSuccess: refreshList,
    onError: onErrorRefresh,
  });

  const deleteRuleMutation = useMutation({
    mutationFn: ({ ruleDefinitionId, force }: { ruleDefinitionId: string; force?: boolean }) =>
      rulesApi.deleteRule(ruleDefinitionId, { force }),
    onSuccess: refreshList,
    onError: onErrorRefresh,
  });

  // ── code families ──────────────────────────────────────────────────────────
  //
  // Changing a prefix changes what the *next* rule is coded; it never rewrites
  // a code already issued. The rule list is still invalidated, because the
  // catalogue's categories are read from the same rows.

  const codePrefixesQuery = useQuery({
    queryKey: ["rules", "codePrefixes"],
    queryFn: () => rulesApi.getCodePrefixes(),
  });

  const refreshPrefixes = () =>
    queryClient.invalidateQueries({ queryKey: ["rules", "codePrefixes"] });

  const setCodePrefixMutation = useMutation({
    mutationFn: ({ category, prefix }: { category: string; prefix: string }) =>
      rulesApi.setCodePrefix(category, prefix),
    onSuccess: refreshPrefixes,
  });

  const clearCodePrefixMutation = useMutation({
    mutationFn: (category: string) => rulesApi.clearCodePrefix(category),
    onSuccess: refreshPrefixes,
  });

  // ── import / export ────────────────────────────────────────────────────────

  const validateImportMutation = useMutation({
    mutationFn: (csv: string) => rulesApi.validateImport(csv),
  });

  const commitImportMutation = useMutation({
    mutationFn: ({ stageId, rows }: { stageId: string; rows: number[] }) =>
      rulesApi.commitImport(stageId, rows),
    onSuccess: () => {
      refreshList();
      refreshPrefixes();
      queryClient.invalidateQueries({ queryKey: ["rules", "catalogue"] });
    },
  });

  return {
    search,
    setSearch,
    status,
    setStatus,
    category,
    setCategory,
    catalogueQuery,
    rulesQuery,
    validateScriptMutation,
    testExamplesMutation,
    createRuleMutation,
    updateRuleMutation,
    deleteRuleMutation,
    codePrefixesQuery,
    setCodePrefixMutation,
    clearCodePrefixMutation,
    validateImportMutation,
    commitImportMutation,
    isMissing,
  };
}
