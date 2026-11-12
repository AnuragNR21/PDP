import { Tooltip, Typography, type TypographyProps } from '@mui/material';
import { useState, type ReactNode } from 'react';

/**
 * One line of text that is cut with "…" when it does not fit, and shows the
 * whole of it on hover — only when it was actually cut, so short text gets no
 * needless tooltip.
 */
export function OverflowText({ children, tooltip, ...props }: TypographyProps & { tooltip?: ReactNode }) {
  const [cut, setCut] = useState(false);
  return (
    <Tooltip title={cut ? tooltip ?? children : ''} enterDelay={300} placement="bottom-start">
      <Typography
        noWrap
        {...props}
        onMouseEnter={(event) => {
          const el = event.currentTarget;
          setCut(el.scrollWidth > el.clientWidth + 1);
          props.onMouseEnter?.(event);
        }}
      >
        {children}
      </Typography>
    </Tooltip>
  );
}
