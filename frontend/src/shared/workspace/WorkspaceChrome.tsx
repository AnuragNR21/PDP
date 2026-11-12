import { OverflowText } from './OverflowText';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import ListOutlined from '@mui/icons-material/ListOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import { Box, Button, Chip, Paper, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { ModelKindIcon } from './WorkspaceIcons';
import {
  MODEL_KIND_LABEL,
  MODEL_NAV_LABEL,
  PROJECTION_LABEL,
  type ModelNavTab,
  type ProjectionView,
  type WorkspaceModel,
} from './workspaceModel';

/** Model Navigation: Model | Relationship | Data Exchange. */
export function ModelNav(props: { value: ModelNavTab; onChange: (tab: ModelNavTab) => void; tabs?: ModelNavTab[]; trailing?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
      <Tabs
        value={props.value}
        onChange={(_event, value: ModelNavTab) => props.onChange(value)}
        sx={{ minHeight: 40, flex: 1, minWidth: 0, '& .MuiTab-root': { minHeight: 40, py: 0.5, textTransform: 'none', fontSize: 15, fontWeight: 700, minWidth: { xs: 0, sm: 90 }, px: { xs: 1.25, sm: 2 } } }}
        aria-label="Model navigation"
      >
        {(props.tabs ?? (Object.keys(MODEL_NAV_LABEL) as ModelNavTab[])).map((tab) => (
          <Tab key={tab} value={tab} label={MODEL_NAV_LABEL[tab]} />
        ))}
      </Tabs>
      {props.trailing}
    </Stack>
  );
}

const PROJECTION_ICON: Record<ProjectionView, ReactElement> = {
  hierarchy: <AccountTreeOutlined sx={{ fontSize: 16 }} />,
  diagram: <SchemaOutlined sx={{ fontSize: 16 }} />,
  matrix: <GridViewOutlined sx={{ fontSize: 16 }} />,
  list: <ListOutlined sx={{ fontSize: 16 }} />,
};

/** Projection Navigation: the views of the open model (or of the relationships). */
export function ProjectionNav(props: {
  views: ProjectionView[];
  value: ProjectionView | null;
  onChange: (view: ProjectionView) => void;
  trailing?: ReactNode;
}) {
  if (props.views.length === 0) return null;
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 34 }}>
      <Tabs
        value={props.value ?? props.views[0]}
        onChange={(_event, value: ProjectionView) => props.onChange(value)}
        sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, py: 0.25, px: 1.5, textTransform: 'none', fontSize: 13, fontWeight: 600 } }}
        aria-label="Projection navigation"
      >
        {props.views.map((view) => (
          <Tab key={view} value={view} label={PROJECTION_LABEL[view]} icon={PROJECTION_ICON[view]} iconPosition="start" />
        ))}
      </Tabs>
      <Box sx={{ flex: 1 }} />
      {props.trailing}
    </Stack>
  );
}

/**
 * The header of an open model: its kind, name and description, a few counts,
 * and ✎ Model. In MWS that edits the model; in SWS the model is read-only, so
 * the same button opens it in MWS.
 */
export function ModelHeaderCard(props: {
  model: WorkspaceModel;
  counts?: Array<{ label: string; value: number | string }>;
  editLabel?: string;
  editTooltip?: string;
  onEdit?: () => void;
  actions?: ReactNode;
  /** A line under the description — the model's Package and what it extends. */
  meta?: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1.75}>
        <ModelKindIcon kind={props.model.kind} size={38} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <OverflowText variant="subtitle1" fontWeight={700} >
              {props.model.name}
            </OverflowText>
            <Chip size="small" label={lifecycleLabel(props.model.status)} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
          </Stack>
          <OverflowText variant="body2" color="text.secondary" >
            {props.model.description || MODEL_KIND_LABEL[props.model.kind]}
          </OverflowText>
          {props.meta}
        </Box>
        {props.counts && props.counts.length > 0 && (
          <Stack direction="row" spacing={2} sx={{ display: { xs: 'none', md: 'flex' } }}>
            {props.counts.map((count) => (
              <Box key={count.label} sx={{ textAlign: 'right' }}>
                <Typography variant="subtitle2" fontWeight={700} lineHeight={1.2}>
                  {count.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {count.label}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
        {props.actions}
        {props.onEdit && (
          <Tooltip title={props.editTooltip ?? 'Edit model'}>
            <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={props.onEdit}>
              {props.editLabel ?? 'Model'}
            </Button>
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}
