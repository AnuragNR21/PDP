import { OverflowText } from './OverflowText';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import { Box, Chip, ListItemButton, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export type RelationshipDetailsItem = {
  key: string;
  /** The related element, as it should read: "Feeder", "DQ Threshold › 95%". */
  label: string;
  /** How it is related: "child", "has_threshold", a governed type's name. */
  relation?: string;
  /** Which way the relationship points from the selected element. */
  direction?: 'out' | 'in' | 'both';
  secondary?: string;
  badge?: ReactNode;
  onClick?: () => void;
};

export type RelationshipDetailsGroup = {
  title: string;
  items: RelationshipDetailsItem[];
  emptyText?: string;
};

/**
 * Relationship Details: the immediate relationships of whatever is selected,
 * grouped by where they come from. Clicking a related element selects it, so
 * the details walk the model one step at a time.
 */
export function RelationshipDetailsList(props: { groups: RelationshipDetailsGroup[]; loading?: boolean }) {
  if (props.loading) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading relationships…
      </Typography>
    );
  }
  const total = props.groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <Stack spacing={1.5}>
      {total === 0 && (
        <Typography variant="body2" color="text.secondary">
          No relationships yet.
        </Typography>
      )}
      {props.groups
        .filter((group) => group.items.length > 0 || group.emptyText)
        .map((group) => (
          <Box key={group.title}>
            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              {group.title} ({group.items.length})
            </Typography>
            {group.items.length === 0 ? (
              <Typography variant="caption" color="text.disabled" display="block">
                {group.emptyText}
              </Typography>
            ) : (
              group.items.map((item) => (
                <ListItemButton
                  key={item.key}
                  disabled={!item.onClick}
                  onClick={item.onClick}
                  sx={{ borderRadius: 1, py: 0.5, px: 1, gap: 1, '&.Mui-disabled': { opacity: 1 } }}
                >
                  {item.badge}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <OverflowText variant="body2" fontWeight={600} >
                      {item.direction === 'in' && <ArrowForwardOutlined sx={{ fontSize: 13, mr: 0.5, transform: 'rotate(180deg)', verticalAlign: 'middle', color: 'text.secondary' }} />}
                      {item.direction === 'out' && <ArrowForwardOutlined sx={{ fontSize: 13, mr: 0.5, verticalAlign: 'middle', color: 'text.secondary' }} />}
                      {item.label}
                    </OverflowText>
                    {item.secondary && (
                      <OverflowText variant="caption" color="text.secondary" display="block">
                        {item.secondary}
                      </OverflowText>
                    )}
                  </Box>
                  {item.relation && <Chip size="small" label={item.relation} sx={{ height: 20, fontSize: 11, maxWidth: 140 }} />}
                </ListItemButton>
              ))
            )}
          </Box>
        ))}
    </Stack>
  );
}
