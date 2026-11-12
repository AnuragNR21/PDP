import { ButtonBase, Typography } from '@mui/material';
import type { ElementType } from 'react';

/**
 * One button of a diagram toolbar. Every diagram in MWS, SWS and Impact uses
 * this same compact look — icon and short label in an outlined chip, blue when
 * active — so the toolbars read alike wherever they appear.
 */
export function DiagramToolButton(props: { label: string; icon: ElementType; active?: boolean; onClick: () => void }) {
  const Icon = props.icon;
  return (
    <ButtonBase
      onClick={props.onClick}
      aria-pressed={props.active ?? undefined}
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        gap: 0.5,
        border: '1px solid',
        borderColor: props.active ? 'primary.main' : 'divider',
        color: props.active ? 'primary.main' : 'text.secondary',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        '&:hover': { bgcolor: 'action.hover', borderColor: props.active ? 'primary.main' : 'text.secondary' },
      }}
    >
      <Icon sx={{ fontSize: 16 }} />
      <Typography variant="caption" fontWeight={props.active ? 700 : 500} sx={{ fontSize: 11 }}>
        {props.label}
      </Typography>
    </ButtonBase>
  );
}
