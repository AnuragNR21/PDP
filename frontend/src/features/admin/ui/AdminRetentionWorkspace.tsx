/**
 * Admin → Data retention.
 *
 * The screen is Admin's; the policy belongs to Discover, which owns the
 * sessions being deleted, so the body lives in that slice and this is the
 * page that frames it.
 */
import { WorkspacePage } from "@/shared/workspace/WorkspacePage";
import DeleteSweepOutlined from "@mui/icons-material/DeleteSweepOutlined";

import { DiscoverRetentionAdmin } from "@/features/discover/ui/DiscoverRetentionAdmin";

export function AdminRetentionWorkspace() {
  return (
    <WorkspacePage
      icon={<DeleteSweepOutlined />}
      workspace="Admin"
      pageTitle="Data retention"
      description="How long an archived discovery session is kept, and when the job that deletes them runs."
    >
      <DiscoverRetentionAdmin />
    </WorkspacePage>
  );
}
