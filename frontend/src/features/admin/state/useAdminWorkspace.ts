import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/features/admin/api/adminApi";

export function useAuditRecords() {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () => (await adminApi.getAudit()).items
  });
}
