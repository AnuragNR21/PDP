import { OverflowText } from './OverflowText';
import { lifecycleLabel } from "@/shared/constants/lifecycle";
import { Box, Card, CardActionArea, Chip, Paper, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { ModelKindIcon } from './WorkspaceIcons';
import type { RecentModelRef } from './useRecentModels';
import { MODEL_KIND_LABEL, type ModelKind, type WorkspaceKind, type WorkspaceModel } from './workspaceModel';

/**
 * The landing page of a workspace: no model open yet. Shows the models this
 * browser opened recently (or, the first time, the models there are), so the
 * usual next step is one click.
 */
export function WorkspaceLanding(props: {
  workspace: WorkspaceKind;
  models: WorkspaceModel[];
  recent: RecentModelRef[];
  onOpen: (kind: ModelKind, id: string) => void;
}) {
  const recentModels = useMemo(() => {
    const byId = new Map(props.models.map((model) => [model.id, model]));
    return props.recent.map((ref) => byId.get(ref.id)).filter((model): model is WorkspaceModel => Boolean(model));
  }, [props.models, props.recent]);
  const shown = recentModels.length > 0 ? recentModels : props.models.slice(0, 8);
  const heading = recentModels.length > 0 ? 'Recent models' : 'Models';
  const prompt =
    props.workspace === 'mws'
      ? 'Create or select a model to start authoring its definitions.'
      : 'Select a model to manage its instances.';

  return (
    <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 3 }}>
      <Typography variant="h6">{props.workspace === 'mws' ? 'Model Workspace' : 'Structure Workspace'}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {prompt}
      </Typography>
      {shown.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {props.workspace === 'mws' ? 'There are no models yet. Use + Model to create the first one.' : 'There are no models yet. Models are created in the Model Workspace.'}
        </Typography>
      ) : (
        <>
          <Typography variant="overline" color="text.secondary">
            {heading}
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', mt: 1 }}>
            {shown.map((model) => (
              <Card key={model.id} variant="outlined">
                <CardActionArea onClick={() => props.onOpen(model.kind, model.id)} sx={{ p: 1.5, height: '100%' }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <ModelKindIcon kind={model.kind} size={34} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <OverflowText variant="subtitle2" fontWeight={700} >
                        {model.name}
                      </OverflowText>
                      <OverflowText variant="caption" color="text.secondary" display="block" >
                        {MODEL_KIND_LABEL[model.kind]}
                      </OverflowText>
                      {model.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {model.description}
                        </Typography>
                      )}
                    </Box>
                    <Chip size="small" variant="outlined" label={lifecycleLabel(model.status)} sx={{ height: 20, fontSize: 11 }} />
                  </Stack>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </>
      )}
    </Paper>
  );
}
