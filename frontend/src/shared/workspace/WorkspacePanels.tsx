import { OverflowText } from './OverflowText';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import FullscreenExitOutlined from '@mui/icons-material/FullscreenExitOutlined';
import FullscreenOutlined from '@mui/icons-material/FullscreenOutlined';
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { HorizontalResizablePanels } from '../components/HorizontalResizablePanels';

export function useStoredFlag(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Not remembered across visits, still works for this one.
      }
    },
    [key],
  );
  return [value, update] as const;
}

/**
 * Existing editors draw their own outlined card. Inside a workspace panel that
 * would be a border within a border, so the panel flattens a card that is its
 * direct child.
 */
const flattenNestedCard = {
  '& > .MuiCard-root, & > .MuiPaper-outlined': { border: 'none', borderRadius: 0, boxShadow: 'none', height: '100%' },
};

/**
 * Padding of a panel's scrolling body. The top gap is a spacer that scrolls
 * away rather than padding: a sticky table header sticks at the padding edge,
 * so top padding would leave a strip above the header where rows show through.
 */
const SCROLL_BODY_PADDING = {
  px: 1.5,
  pb: 1.5,
  '&::before': { content: '""', display: 'block', flexShrink: 0, height: 12 },
} as const;

/**
 * The Authoring Workspace: where a model or its instances are built.
 *
 * Full Screen lifts this same element over the page with CSS rather than
 * re-mounting it elsewhere, so whatever is in progress — the selection, an
 * unsaved edit, a diagram's viewport — is exactly as it was on the way back,
 * and the panels around it keep the state they had.
 */
export function AuthoringPanel(props: {
  title: string;
  /** Short guidance under the title, e.g. how parent-child relationships are made. */
  hint?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  /** Let the content run to the edges (diagrams, matrices, embedded cards). */
  flush?: boolean;
}) {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      // A dialog open over the full-screen panel takes Escape for itself.
      if (event.key === 'Escape' && !document.querySelector('.MuiDialog-root')) setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);

  return (
    <Paper
      variant="outlined"
      data-fullscreen={fullScreen || undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
        ...(fullScreen
          ? { position: 'fixed', inset: 0, zIndex: (theme) => theme.zIndex.drawer + 2, borderRadius: 0, m: 0 }
          : {}),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', minHeight: 44 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <OverflowText variant="subtitle2" fontWeight={700} >
            {props.title}
          </OverflowText>
          {props.hint && (
            <OverflowText variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', display: 'block' }} >
              {props.hint}
            </OverflowText>
          )}
        </Box>
        {props.toolbar}
        <Tooltip title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen'}>
          <IconButton size="small" onClick={() => setFullScreen((value) => !value)} aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}>
            {fullScreen ? <FullscreenExitOutlined fontSize="small" /> : <FullscreenOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', ...(props.flush ? flattenNestedCard : SCROLL_BODY_PADDING) }}>
        {props.children}
      </Box>
    </Paper>
  );
}

export type DetailsSectionConfig = {
  title: string;
  actions?: ReactNode;
  content: ReactNode;
  /** Shown instead of the content when nothing is selected. */
  empty?: string;
  isEmpty?: boolean;
  flush?: boolean;
};

function DetailsSection(props: DetailsSectionConfig & { collapsed: boolean; onToggle: () => void; grow: number; onHideColumn?: () => void }) {
  return (
    <Paper
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', flex: props.collapsed ? '0 0 auto' : `${props.grow} 1 0` }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pl: 1, pr: 1, py: 0.5, borderBottom: props.collapsed ? 0 : 1, borderColor: 'divider', minHeight: 40 }}>
        <Tooltip title={props.collapsed ? `Expand ${props.title}` : `Collapse ${props.title}`}>
          <IconButton size="small" onClick={props.onToggle} aria-label={props.collapsed ? `Expand ${props.title}` : `Collapse ${props.title}`}>
            {props.collapsed ? <ExpandMoreOutlined fontSize="small" /> : <ExpandLessOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
        <OverflowText variant="subtitle2" fontWeight={700} sx={{ flex: 1 }} >
          {props.title}
        </OverflowText>
        {!props.isEmpty && props.actions}
        {props.onHideColumn && (
          // Folding the whole details column lives in the first section's
          // header, inside the panel, so it never overlaps the splitter.
          <Tooltip title="Hide details">
            <IconButton size="small" onClick={props.onHideColumn} aria-label="Hide details">
              <ChevronRightOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {!props.collapsed && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...(props.flush ? flattenNestedCard : SCROLL_BODY_PADDING) }}>
          {props.isEmpty ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: props.flush ? 1.5 : 0 }}>
              {props.empty ?? 'Nothing selected.'}
            </Typography>
          ) : (
            props.content
          )}
        </Box>
      )}
    </Paper>
  );
}

/**
 * Authoring Workspace beside Element Details over Relationship Details.
 *
 * The split between them can be dragged; each details section folds to its
 * header, and the whole details column folds to a strip at the edge. Every one
 * of those choices is remembered per workspace view, so coming back finds the
 * panels as they were left.
 */
export function WorkspaceBody(props: {
  /** Distinguishes the remembered panel state of one view from another's. */
  storageKey: string;
  authoring: ReactNode;
  element?: DetailsSectionConfig;
  relationship?: DetailsSectionConfig;
  /** A third section under the other two (Impact's Connected Context). */
  extra?: DetailsSectionConfig;
}) {
  const [detailsCollapsed, setDetailsCollapsed] = useStoredFlag(`pdp-${props.storageKey}-details-collapsed`, false);
  const [elementCollapsed, setElementCollapsed] = useStoredFlag(`pdp-${props.storageKey}-element-collapsed`, false);
  const [relationshipCollapsed, setRelationshipCollapsed] = useStoredFlag(`pdp-${props.storageKey}-relationship-collapsed`, false);
  const [extraCollapsed, setExtraCollapsed] = useStoredFlag(`pdp-${props.storageKey}-extra-collapsed`, false);
  const hasDetails = Boolean(props.element || props.relationship || props.extra);

  if (!hasDetails) {
    return <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{props.authoring}</Box>;
  }

  if (detailsCollapsed) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{props.authoring}</Box>
        <Paper variant="outlined" sx={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 1 }}>
          <Tooltip title="Show details" placement="left">
            <IconButton size="small" onClick={() => setDetailsCollapsed(false)} aria-label="Show details">
              <ChevronLeftOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ writingMode: 'vertical-rl', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setDetailsCollapsed(false)}
          >
            {[props.element?.title, props.relationship?.title, props.extra?.title].filter(Boolean).join(' · ')}
          </Typography>
        </Paper>
      </Box>
    );
  }

  const hideColumn = () => setDetailsCollapsed(true);
  const details = (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      {props.element && (
        <DetailsSection {...props.element} collapsed={elementCollapsed} onToggle={() => setElementCollapsed(!elementCollapsed)} grow={3} onHideColumn={hideColumn} />
      )}
      {props.relationship && (
        <DetailsSection
          {...props.relationship}
          onHideColumn={props.element ? undefined : hideColumn}
          collapsed={relationshipCollapsed}
          onToggle={() => setRelationshipCollapsed(!relationshipCollapsed)}
          grow={2}
        />
      )}
      {props.extra && (
        <DetailsSection {...props.extra} collapsed={extraCollapsed} onToggle={() => setExtraCollapsed(!extraCollapsed)} grow={3} />
      )}
    </Stack>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0 }}>
      <HorizontalResizablePanels
        left={{
          storageKey: `pdp-${props.storageKey}-authoring-width`,
          minWidth: '35%',
          maxWidth: '80%',
          defaultWidth: '64%',
          component: <Box sx={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>{props.authoring}</Box>,
        }}
        right={{ minWidth: 280, component: details }}
      />
    </Box>
  );
}
