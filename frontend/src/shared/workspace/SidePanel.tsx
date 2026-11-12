import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * The left selection panel of a workspace (Model Selection in MWS and SWS,
 * Item Selection in Impact). It folds to a strip and opens again only when the
 * person clicks — nothing else changes it.
 */
export function SidePanel(props: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  width?: number;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  if (props.collapsed) {
    return (
      <Paper variant="outlined" sx={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 1, height: '100%' }}>
        <Tooltip title={`Expand ${props.title}`} placement="right">
          <IconButton size="small" onClick={props.onToggle} aria-label={`Expand ${props.title}`}>
            <ChevronRightOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 600, letterSpacing: 0.5, cursor: 'pointer' }}
          onClick={props.onToggle}
        >
          {props.title}
        </Typography>
      </Paper>
    );
  }
  return (
    <Paper variant="outlined" sx={{ width: props.width ?? 280, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          {props.title}
        </Typography>
        {props.actions}
        <Tooltip title={`Collapse ${props.title}`}>
          <IconButton size="small" onClick={props.onToggle} aria-label={`Collapse ${props.title}`}>
            <ChevronLeftOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, '& > *': { flex: 1, minHeight: 0 } }}>{props.children}</Box>
      {props.footer && <Box sx={{ flexShrink: 0, p: 1.5, borderTop: 1, borderColor: 'divider' }}>{props.footer}</Box>}
    </Paper>
  );
}
