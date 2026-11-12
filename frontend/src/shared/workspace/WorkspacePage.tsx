import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import { Stack } from '@mui/material';
import type { PropsWithChildren, ReactNode } from 'react';
import { HeaderChip, WorkspaceHeaderCard, type HeaderCount } from './WorkspaceHeaderCard';

/** Admin's colour in the header tile. */
export const ADMIN_COLOR = '#455a64';

/**
 * A page of a workspace section (Admin) in the shared workspace layout: the
 * header card — icon, page name, status chip, one line of description — and
 * then the page's panels.
 *
 * Takes the same props as the older WorkspacePageTemplate, so a page moves
 * over by changing its import; the breadcrumb and the large title are gone
 * because the tab bar above already says where you are.
 */
export function WorkspacePage(
  props: PropsWithChildren<{
    workspace: string;
    pageTitle: string;
    description: string;
    status?: string;
    icon?: ReactNode;
    color?: string;
    counts?: HeaderCount[];
    actions?: ReactNode;
  }>,
) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <WorkspaceHeaderCard
        icon={props.icon ?? <AdminPanelSettingsOutlined />}
        color={props.color ?? ADMIN_COLOR}
        title={props.pageTitle}
        chip={props.status ? <HeaderChip label={props.status} /> : undefined}
        description={props.description}
        counts={props.counts}
        actions={props.actions}
      />
      {props.children}
    </Stack>
  );
}
