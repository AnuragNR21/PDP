import { Box } from '@mui/material';
import { ReactNode } from 'react';
import { useHorizontalResize } from '../hooks/useHorizontalResize';

interface PanelConfig {
  /** localStorage key for this panel width */
  storageKey?: string;
  /** Minimum width for panel in pixels or percentage (e.g., "20%") */
  minWidth?: number | string;
  /** Maximum width for panel in pixels or percentage (e.g., "80%") */
  maxWidth?: number | string;
  /** Default width for panel in pixels or percentage (e.g., "75%") - left only */
  defaultWidth?: number | string;
  /** Panel content */
  component: ReactNode;
}

export interface HorizontalResizablePanelsProps {
  /** Left panel configuration */
  left: PanelConfig;
  /** Right panel configuration */
  right: PanelConfig;
  /** @deprecated Prefer panel-level keys (`left.storageKey` / `right.storageKey`) */
  storageKey?: string;
  /** Hide splitter on small screens; defaults to true */
  hideOnMobile?: boolean;
}

/**
 * Two-column layout with horizontal resize splitter using flexbox
 *
 * Features:
 * - Left panel: flex-basis set to tracked width, constrained by CSS min/max-width
 * - Right panel: flex: 1, takes remaining space
 * - Constraints enforced via CSS properties, not JavaScript
 * - Width persisted to localStorage
 * - Responsive: splitter hidden on mobile
 */
export function HorizontalResizablePanels(props: HorizontalResizablePanelsProps) {
  const { left, right, storageKey, hideOnMobile = true } = props;
  const resolvedStorageKey = left.storageKey ?? right.storageKey ?? storageKey;

  if (!resolvedStorageKey) {
    throw new Error('HorizontalResizablePanels requires a storage key on left/right panel config.');
  }

  const { width, isResizing, containerRef, startResize } = useHorizontalResize({
    storageKey: resolvedStorageKey,
    left: {
      minWidth: left.minWidth,
      maxWidth: left.maxWidth,
      defaultWidth: left.defaultWidth,
    },
    right: {
      minWidth: right.minWidth,
      maxWidth: right.maxWidth,
    },
  });

  const hideDisplay = hideOnMobile ? { xs: 'none', md: 'flex' } : 'flex';

  // Format width for flex-basis (handle both number and percentage)
  const flexBasis = typeof width === 'string' && width.endsWith('%') ? width : `${width}px`;

  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
        height: '100%',
        alignItems: 'stretch',
        cursor: isResizing ? 'col-resize' : 'default',
        userSelect: isResizing ? 'none' : 'auto',
      }}
    >
      {/* Left panel - uses flex-basis for width, CSS properties for constraints */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          // Flexbox approach: flex-basis for width, min/max-width for constraints
          flexBasis: { xs: '100%', md: flexBasis },
          minWidth: { xs: '100%', md: left.minWidth ? (typeof left.minWidth === 'string' && left.minWidth.endsWith('%') ? left.minWidth : `${left.minWidth}px`) : 'auto' },
          maxWidth: { xs: '100%', md: left.maxWidth ? (typeof left.maxWidth === 'string' && left.maxWidth.endsWith('%') ? left.maxWidth : `${left.maxWidth}px`) : 'auto' },
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {left.component}
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        sx={{
          display: hideDisplay,
          width: 6,
          mx: -1,
          cursor: 'col-resize',
          justifyContent: 'center',
          alignItems: 'center',
          flexShrink: 0,
          '&::before': {
            content: '""',
            width: 2,
            height: '100%',
            borderRadius: 999,
            bgcolor: isResizing ? 'primary.main' : 'divider',
            transition: 'background-color 120ms ease',
          },
        }}
      />

      {/* Right panel - flex: 1 takes remaining space */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          // CSS constraints on right panel
          minWidth: { xs: 0, md: right.minWidth ? (typeof right.minWidth === 'string' && right.minWidth.endsWith('%') ? right.minWidth : `${right.minWidth}px`) : 0 },
          maxWidth: { xs: '100%', md: right.maxWidth ? (typeof right.maxWidth === 'string' && right.maxWidth.endsWith('%') ? right.maxWidth : `${right.maxWidth}px`) : 'auto' },
        }}
      >
        {right.component}
      </Box>
    </Box>
  );
}
