/**
 * The retention policy for archived discovery sessions.
 *
 * Kept out of `useDiscoverWorkspace` because that hook is scoped to one
 * session and this is an organisation-wide setting — an Admin screen should
 * not have to mount a session's worth of queries to change a number.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { discoverApi } from "../api/discoverApi";

const KEY = ["discover", "retention"] as const;

export function useRetentionPolicy() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: KEY,
    queryFn: () => discoverApi.getRetention(),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: KEY });
    // The countdown shown against every archived session is derived from this
    // policy, so changing it has to refresh the session lists too.
    await queryClient.invalidateQueries({ queryKey: ["discover", "sessions"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: { retention_days?: number; purge_hour_utc?: number }) =>
      discoverApi.updateRetention(payload),
    onSuccess: invalidate,
  });

  const runNowMutation = useMutation({
    mutationFn: () => discoverApi.runRetentionNow(),
    onSuccess: invalidate,
  });

  return { statusQuery, saveMutation, runNowMutation };
}
