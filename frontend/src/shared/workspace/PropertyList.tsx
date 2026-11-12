import AddOutlined from '@mui/icons-material/AddOutlined';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { OverflowText } from './OverflowText';
import { DeleteAction, EditAction } from './WorkspaceIcons';

export type PropertyListItem = {
  id: string;
  name: string;
  description?: string;
  chips?: Array<{ label: string; color?: 'default' | 'success' | 'info' | 'warning' }>;
};

/**
 * The properties of a node type or element type, shaped for the narrow
 * details column: one "+ Property" button, then one compact row per property
 * with its own ✎ and 🗑 — no wide table, no select-then-act toolbar.
 */
export function PropertyList(props: {
  items: PropertyListItem[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  addDisabled?: boolean;
  disabled?: boolean;
  emptyText: string;
}) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          Properties ({props.items.length})
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={props.onAdd} disabled={props.addDisabled || props.disabled} sx={{ textTransform: 'none' }}>
          Property
        </Button>
      </Stack>
      {props.items.length === 0 ? (
        <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {props.emptyText}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.75}>
          {props.items.map((item) => (
            <Stack
              key={item.id}
              direction="row"
              spacing={1}
              alignItems="flex-start"
              sx={{ px: 1.25, py: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <OverflowText variant="body2" fontWeight={600}>
                  {item.name}
                </OverflowText>
                {item.description && (
                  <OverflowText variant="caption" color="text.secondary" display="block">
                    {item.description}
                  </OverflowText>
                )}
                {item.chips && item.chips.length > 0 && (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                    {item.chips.map((chip) => (
                      <Chip key={chip.label} size="small" variant="outlined" color={chip.color ?? 'default'} label={chip.label} sx={{ height: 20, fontSize: 11 }} />
                    ))}
                  </Stack>
                )}
              </Box>
              <Stack direction="row" sx={{ flexShrink: 0 }}>
                <EditAction label={item.name} onClick={() => props.onEdit(item.id)} disabled={props.disabled} />
                <DeleteAction label={item.name} onClick={() => props.onDelete(item.id)} disabled={props.disabled} />
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
