import { Avatar, Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { OverflowText } from './OverflowText';

export type HeaderCount = { label: string; value: number | string; hint?: string };

/**
 * The header of whatever is open in a workspace — a discovery session, the
 * rule library, an Admin page. Same shape as the open model's header in MWS
 * and SWS: an icon tile, the name with a status chip, one line of
 * description, a few counts, then the actions that act on the whole thing.
 */
export function WorkspaceHeaderCard(props: {
  icon: ReactNode;
  color?: string;
  title: ReactNode;
  chip?: ReactNode;
  description?: ReactNode;
  counts?: HeaderCount[];
  actions?: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, flexShrink: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1.75}>
        <Avatar variant="rounded" sx={{ width: 38, height: 38, bgcolor: props.color ?? 'primary.main', '& svg': { fontSize: 22 } }}>
          {props.icon}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <OverflowText variant="subtitle1" fontWeight={700}>
              {props.title}
            </OverflowText>
            {props.chip}
          </Stack>
          {props.description && (
            <OverflowText variant="body2" color="text.secondary">
              {props.description}
            </OverflowText>
          )}
        </Box>
        {props.counts && props.counts.length > 0 && (
          <Stack direction="row" spacing={2} sx={{ display: { xs: 'none', md: 'flex' }, flexShrink: 0 }}>
            {props.counts.map((count) => (
              <Tooltip key={count.label} title={count.hint ?? ''}>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="subtitle2" fontWeight={700} lineHeight={1.2}>
                    {count.value}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {count.label}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          </Stack>
        )}
        {props.actions && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            {props.actions}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

/** The small status chip used in every workspace header. */
export function HeaderChip(props: { label: string; color?: 'default' | 'success' | 'warning' | 'error' | 'info' }) {
  return <Chip size="small" variant="outlined" color={props.color ?? 'default'} label={props.label} sx={{ height: 20, fontSize: 11, flexShrink: 0 }} />;
}

/**
 * A titled panel inside a workspace page — the same frame as the Authoring
 * Workspace panel (title, italic hint, toolbar on the right), without full
 * screen. Admin's tables and forms sit in these.
 */
export function SectionPanel(props: { title: string; hint?: ReactNode; toolbar?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', minHeight: 44 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <OverflowText variant="subtitle2" fontWeight={700}>
            {props.title}
          </OverflowText>
          {props.hint && (
            <OverflowText variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', display: 'block' }}>
              {props.hint}
            </OverflowText>
          )}
        </Box>
        {props.toolbar}
      </Stack>
      <Box sx={{ minWidth: 0, overflowX: 'auto', ...(props.flush ? {} : { p: 1.5 }) }}>{props.children}</Box>
    </Paper>
  );
}
