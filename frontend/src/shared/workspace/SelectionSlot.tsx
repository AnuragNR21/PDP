import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where a view's selection panel is drawn.
 *
 * `undefined` — the view lays the panel out itself, beside its content (the
 * old layout, still used where a view stands alone).
 * An element — the workspace gives the panel its left-hand Selection column,
 * so the Relationship views line up with the Model views; the panel is
 * portalled there and keeps living inside the view, with its state.
 * `null` — that column is folded away, so nothing is drawn.
 */
export type SelectionSlot = HTMLElement | null | undefined;

export function renderSelection(slot: SelectionSlot, panel: ReactNode, inlineWidth: number) {
  if (slot === undefined) {
    return (
      <Box width={inlineWidth} flexShrink={0} display="flex" minHeight={0}>
        {panel}
      </Box>
    );
  }
  return slot ? createPortal(panel, slot) : null;
}
