import { AccountTreeOutlined, AddOutlined, LayersOutlined } from '@mui/icons-material';
import { Avatar, Box, Button, Card, Divider, List, ListItemAvatar, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import type { HierarchyModelSummary, SupportDomainModelSummary } from '../../domain/types';

export function ModelWorkspaceNav(props: {
  hierarchyModels: HierarchyModelSummary[];
  supportDomainModels: SupportDomainModelSummary[];
  selectedHierarchyModelId: string | null;
  selectedSupportDomainModelId: string | null;
  onSelectHierarchyModel: (id: string | null) => void | Promise<void>;
  onSelectSupportDomainModel: (id: string | null) => void | Promise<void>;
  onCreateHierarchyModel: () => void;
  onCreateSupportDomainModel: () => void;
}) {
  const {
    hierarchyModels,
    supportDomainModels,
    selectedHierarchyModelId,
    selectedSupportDomainModelId,
    onSelectHierarchyModel,
    onSelectSupportDomainModel,
    onCreateHierarchyModel,
    onCreateSupportDomainModel,
  } = props;

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
            Hierarchy Models
          </Typography>
          <List dense disablePadding>
            {hierarchyModels.map((item) => (
              <ListItemButton
                key={item.id}
                selected={item.id === selectedHierarchyModelId}
                onClick={() => void onSelectHierarchyModel(item.id)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemAvatar sx={{ minWidth: 40 }}>
                  <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.main', fontSize: 14 }}>
                    <AccountTreeOutlined sx={{ fontSize: 16 }} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText primary={item.name} primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
              </ListItemButton>
            ))}
          </List>

          <Divider sx={{ my: 1 }} />

          <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
            Support Domain Models
          </Typography>
          <List dense disablePadding>
            {supportDomainModels.map((item) => (
              <ListItemButton
                key={item.id}
                selected={item.id === selectedSupportDomainModelId}
                onClick={() => void onSelectSupportDomainModel(item.id)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemAvatar sx={{ minWidth: 40 }}>
                  <Avatar sx={{ width: 28, height: 28, bgcolor: 'secondary.main', fontSize: 14 }}>
                    <LayersOutlined sx={{ fontSize: 16 }} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText primary={item.name} primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
              </ListItemButton>
            ))}
          </List>
        </Stack>
      </Box>

      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Stack spacing={1}>
          <Button fullWidth variant="outlined" size="small" startIcon={<AddOutlined />} onClick={onCreateHierarchyModel}>
            Add Hierarchy Model
          </Button>
          <Button fullWidth variant="outlined" size="small" startIcon={<AddOutlined />} onClick={onCreateSupportDomainModel}>
            Add Support Domain Model
          </Button>
        </Stack>
      </Box>
    </Card>
  );
}
