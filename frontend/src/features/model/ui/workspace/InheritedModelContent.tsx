import CallSplitOutlined from '@mui/icons-material/CallSplitOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import { Box, Button, Chip, CircularProgress, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/shared/toast/ToastContext';
import { anchorCandidates, currentExtensionLink, defaultAnchor, EXTENSION_LINK_NAME, rootOf } from '../../domain/extensionLink';
import { linkExtension } from '../../state/extensionLinks';
import { relationshipKindLabel } from '@/features/cross-model';
import { CanonicalBadge } from '@/features/structure/ui/shared/CanonicalBadge';
import { useStoredFlag } from '@/shared/workspace/WorkspacePanels';
import type { WorkspaceModel } from '@/shared/workspace/workspaceModel';
import { modelDefinitionsApi } from '../../api/modelDefinitionsApi';
import type { HierarchyNodeSummary } from '../../domain/types';

/** Inherited content is drawn in this colour everywhere, with a lock: it is read only here. */
export const INHERITED_COLOR = '#7B1FA2';

function treeRows(nodes: HierarchyNodeSummary[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, HierarchyNodeSummary[]>();
  for (const node of nodes) {
    const parent = node.parentNodeId && ids.has(node.parentNodeId) ? node.parentNodeId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const list of children.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const rows: Array<{ node: HierarchyNodeSummary; depth: number }> = [];
  const visit = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      rows.push({ node, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/**
 * What an extending model inherits from the common model it extends — shown
 * beside the model's own, package-specific content, marked as inherited and
 * read only. Changing it means opening the common model in its own package.
 */
export function InheritedModelContent(props: {
  base: WorkspaceModel;
  onOpen: () => void;
  maxHeight?: number;
  /** The model doing the extending — for a hierarchy, whose root is attached under an inherited node type. */
  extending?: WorkspaceModel | null;
  /** Told when the attachment changed, so the workspace can refresh its relationships. */
  onLinkChanged?: () => void;
}) {
  const [open, setOpen] = useStoredFlag(`pdp-inherited-open-${props.base.id}`, true);
  const isHierarchy = props.base.kind === 'hierarchy';
  const nodesQuery = useQuery({
    queryKey: ['inherited-hierarchy-nodes', props.base.id],
    queryFn: () => modelDefinitionsApi.listHierarchyNodeTypes(props.base.id),
    enabled: isHierarchy,
  });
  const elementsQuery = useQuery({
    queryKey: ['inherited-sd-elements', props.base.id],
    queryFn: () => modelDefinitionsApi.listSupportDomainElements(props.base.id),
    enabled: !isHierarchy,
  });
  const relationshipsQuery = useQuery({
    queryKey: ['inherited-sd-relationships', props.base.id],
    queryFn: () => modelDefinitionsApi.listSupportDomainRelationships(props.base.id),
    enabled: !isHierarchy,
  });
  // Hierarchy: where the extending model's root hangs in the inherited tree ("Parent of").
  const extendingId = props.extending?.kind === 'hierarchy' ? props.extending.id : null;
  const ownNodesQuery = useQuery({
    queryKey: ['extension-link', 'own-nodes', extendingId],
    queryFn: () => modelDefinitionsApi.listHierarchyNodeTypes(extendingId!),
    enabled: isHierarchy && Boolean(extendingId),
  });
  const linkTypesQuery = useQuery({
    queryKey: ['extension-link', 'types'],
    queryFn: () => modelDefinitionsApi.listCrossModelRelationshipTypes(),
    enabled: isHierarchy && Boolean(extendingId),
  });
  const { showToast } = useToast();
  const [attaching, setAttaching] = useState(false);
  const ownRoot = rootOf(ownNodesQuery.data ?? []);
  const inheritedIds = new Set((nodesQuery.data ?? []).map((node) => node.id));
  const link = ownRoot ? currentExtensionLink(linkTypesQuery.data ?? [], inheritedIds, ownRoot.id) : null;
  const anchorId = link?.sourceModelItemTypeId ?? null;
  const suggested = defaultAnchor(nodesQuery.data ?? []);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const chosenAnchor = pendingAnchor ?? anchorId ?? suggested?.id ?? '';
  const attach = async (target: string) => {
    if (!props.extending) return;
    setAttaching(true);
    try {
      await linkExtension(props.base.id, props.extending.id, target);
      setPendingAnchor(null);
      await Promise.all([ownNodesQuery.refetch(), linkTypesQuery.refetch()]);
      props.onLinkChanged?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not attach the model.', 'error');
    } finally {
      setAttaching(false);
    }
  };

  const loading = isHierarchy ? nodesQuery.isLoading : elementsQuery.isLoading || relationshipsQuery.isLoading;
  const nodes = nodesQuery.data ?? [];
  const elements = elementsQuery.data ?? [];
  const relationships = relationshipsQuery.data ?? [];
  const elementName = new Map(elements.map((e) => [e.id, e.displayName || e.name]));
  const count = isHierarchy ? nodes.length : elements.length;

  return (
    <Box sx={{ border: '1px dashed', borderColor: `${INHERITED_COLOR}66`, borderRadius: 1.5, bgcolor: `${INHERITED_COLOR}07`, flexShrink: 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, py: 0.5 }}>
        <IconButton size="small" onClick={() => setOpen(!open)} aria-label={open ? 'Hide inherited content' : 'Show inherited content'} sx={{ p: 0.25 }}>
          {open ? <ExpandMoreOutlined fontSize="small" /> : <ChevronRightOutlined fontSize="small" />}
        </IconButton>
        <CallSplitOutlined sx={{ fontSize: 16, color: INHERITED_COLOR, transform: 'rotate(180deg)' }} />
        <Typography variant="caption" fontWeight={700} sx={{ color: INHERITED_COLOR, flex: 1, minWidth: 0 }} noWrap>
          Inherited from {props.base.name}
        </Typography>
        <Chip size="small" icon={<LockOutlined sx={{ fontSize: '12px !important' }} />} label="Read only" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />
        <Typography variant="caption" color="text.secondary">
          {count} {isHierarchy ? 'node type' : 'element type'}{count === 1 ? '' : 's'}
        </Typography>
        <Tooltip title="Changes to inherited content are made in the common model, in its own package">
          <Button size="small" startIcon={<OpenInNewOutlined sx={{ fontSize: '14px !important' }} />} onClick={props.onOpen} sx={{ fontSize: 11, py: 0, minWidth: 0 }}>
            Open
          </Button>
        </Tooltip>
      </Stack>
      {open && (
        <Box sx={{ px: 1, pb: 1, maxHeight: props.maxHeight ?? 220, overflowY: 'auto' }}>
          {loading ? (
            <CircularProgress size={18} sx={{ m: 1 }} />
          ) : isHierarchy ? (
            nodes.length === 0 ? (
              <Typography variant="caption" color="text.secondary">The common model has no node types yet.</Typography>
            ) : (
              <>
                {treeRows(nodes).map(({ node, depth }) => (
                  <Box key={node.id}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ pl: 1 + depth * 2, py: 0.25, opacity: 0.9 }} data-inherited="true">
                      <CanonicalBadge badge={node.badge} fallbackText={node.name} size={18} />
                      <Typography variant="body2" sx={{ fontSize: 12.5, fontStyle: 'italic' }} noWrap>
                        {node.displayName || node.name}
                      </Typography>
                      {node.isProperty && <Chip size="small" label="Property" variant="outlined" sx={{ height: 16, fontSize: 9.5 }} />}
                      {node.isRecursive && <Chip size="small" label="Recursive" variant="outlined" sx={{ height: 16, fontSize: 9.5 }} />}
                      <LockOutlined sx={{ fontSize: 11, color: 'text.disabled' }} />
                    </Stack>
                    {/* The extending model continues the tree here: its root is a child of this node type. */}
                    {ownRoot && anchorId === node.id && (
                      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ pl: 1 + (depth + 1) * 2, py: 0.25 }} data-extension-root={ownRoot.id}>
                        <CanonicalBadge badge={ownRoot.badge} fallbackText={ownRoot.name} size={18} />
                        <Typography variant="body2" fontWeight={700} color="primary" sx={{ fontSize: 12.5 }} noWrap>
                          {ownRoot.displayName || ownRoot.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          this model · {node.displayName || node.name} is {EXTENSION_LINK_NAME.toLowerCase()} it
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                ))}
                {ownRoot && props.extending && (
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ pt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <LinkOutlined sx={{ fontSize: 16, color: link ? 'primary.main' : 'warning.main' }} />
                    <Typography variant="caption" color={link ? 'text.secondary' : 'warning.dark'} sx={{ fontWeight: link ? 400 : 700 }}>
                      {link ? `${ownRoot.displayName || ownRoot.name} is a child of` : `${ownRoot.displayName || ownRoot.name} is not attached yet — attach under`}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      value={chosenAnchor}
                      disabled={attaching}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (link) void attach(next);
                        else setPendingAnchor(next);
                      }}
                      inputProps={{ 'aria-label': 'Inherited node type the model is attached under' }}
                      sx={{ minWidth: 160, '& .MuiInputBase-input': { py: 0.4, fontSize: 12.5 } }}
                    >
                      {anchorCandidates(nodes).map(({ node, depth }) => (
                        <MenuItem key={node.id} value={node.id} sx={{ pl: 1.5 + depth * 1.5, fontSize: 13 }}>
                          {node.displayName || node.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    {!link && (
                      <Button size="small" variant="contained" disabled={attaching || !chosenAnchor} onClick={() => void attach(chosenAnchor)} sx={{ py: 0.25 }}>
                        Attach
                      </Button>
                    )}
                    {attaching && <CircularProgress size={14} />}
                  </Stack>
                )}
              </>
            )
          ) : elements.length === 0 ? (
            <Typography variant="caption" color="text.secondary">The common model has no element types yet.</Typography>
          ) : (
            <Stack spacing={0.75}>
              <Stack direction="row" flexWrap="wrap" gap={0.5}>
                {elements.map((element) => (
                  <Chip
                    key={element.id}
                    size="small"
                    variant="outlined"
                    icon={<LockOutlined sx={{ fontSize: '11px !important' }} />}
                    label={element.displayName || element.name}
                    data-inherited="true"
                    sx={{ height: 22, fontSize: 11, fontStyle: 'italic', borderColor: `${INHERITED_COLOR}55`, color: INHERITED_COLOR }}
                  />
                ))}
              </Stack>
              {relationships.length > 0 && (
                <Stack spacing={0.25}>
                  {relationships.map((rel) => (
                    <Typography key={rel.id} variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }} data-inherited="true">
                      {elementName.get(rel.sourceElementId) ?? '?'} → {relationshipKindLabel(rel.relationshipKind)} → {elementName.get(rel.targetElementId) ?? '?'}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </Box>
      )}
    </Box>
  );
}

/** Heads the model's own content when it extends a common model. */
export function PackageSpecificLabel(props: { packageName: string }) {
  return (
    <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ display: 'block', px: 0.5, pt: 0.5 }}>
      Package-specific content · {props.packageName}
    </Typography>
  );
}
