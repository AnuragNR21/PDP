import { Box, Grid } from '@mui/material';
import type { MetadataOption, HierarchyNodePropertyFormData, HierarchyNodePropertySummary, HierarchyNodeDraft, HierarchyNodeSummary, HierarchyNodeTreeItem, HierarchyRuleSummary, InstanceParentAssignment } from '../../domain/types';
import { HorizontalResizablePanels } from '../../../../shared/components/HorizontalResizablePanels';
import { ResizablePanelsStorageKey } from '../../../../shared/constants/ResizablePanelsStorageKeys';
import { NodeTypeTreePanel } from '../tree/NodeTypeTreePanel';
import { SelectedNodeTypeEditor } from '../editor/SelectedNodeTypeEditor';
import { HierarchyRulesTable } from '../tables/HierarchyRulesTable';
import { useBadgeCustomization } from '../../state/useBadgeCustomization';

export function HierarchyModelTab(props: {
  nodeEditorKey?: number;
  hierarchyNodeDraft: HierarchyNodeDraft;
  lifecycleStatuses: MetadataOption[];
  nodes: HierarchyNodeSummary[];
  hierarchyNodeProperties: HierarchyNodePropertySummary[];
  hierarchyNodePropertyFormData: HierarchyNodePropertyFormData;
  tree: HierarchyNodeTreeItem[];
  rules: HierarchyRuleSummary[];
  validation: {
    hierarchyNode: Record<string, string>;
    hierarchyNodeProperty: Record<string, string>;
  };
  saving: boolean;
  onChangeHierarchyNode: (patch: Partial<HierarchyNodeDraft>) => void;
  onChangeHierarchyNodeProperty: (patch: Partial<HierarchyNodePropertyFormData>) => void;
  onSaveHierarchyNode: (options?: { confirmRecursiveRemoval?: boolean }) => Promise<void>;
  onSaveHierarchyModelNodeTypeProperty: (formData?: HierarchyNodePropertyFormData) => Promise<boolean>;
  onDeleteHierarchyNodeProperty: (id: string) => void;
  onDeleteHierarchyNode?: () => void;
  onSelectNode: (id: string) => void | Promise<void>;
  onAddChild: (id: string) => void;
  onReorderNode: (nodeId: string, newParentNodeId: string | null, position: number, confirmInstanceReparent?: boolean, instanceParentAssignments?: InstanceParentAssignment[]) => void;
  onRefreshNodes: () => void | Promise<void>;
  selectedNodeId: string | null;
}) {
  const badge = useBadgeCustomization('hierarchy-node', props.hierarchyNodeDraft.id, { onSaved: () => void props.onRefreshNodes() });

  return (
    <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
      <Grid size={{ xs: 12 }}>
        <HorizontalResizablePanels
          left={{
            storageKey: ResizablePanelsStorageKey.ModelWorkspaceHierarchyNodeTypePanels,
            minWidth: 320,
            maxWidth: 760,
            defaultWidth: 480,
            component: (
              <NodeTypeTreePanel
                items={props.tree}
                selectedNodeId={props.selectedNodeId}
                onSelectNode={props.onSelectNode}
                onAddChild={props.onAddChild}
                onReorderNode={props.onReorderNode}
              />
            ),
          }}
          right={{
            component: (
              <SelectedNodeTypeEditor
                key={props.hierarchyNodeDraft.id ?? `new-${props.nodeEditorKey ?? 0}`}
                draft={props.hierarchyNodeDraft}
                properties={props.hierarchyNodeProperties}
                propertyFormData={props.hierarchyNodePropertyFormData}
                persistedIsRecursive={props.hierarchyNodeDraft.id ? (props.nodes.find((n) => n.id === props.hierarchyNodeDraft.id)?.isRecursive ?? false) : false}
                hasChildren={
                  props.hierarchyNodeDraft.id
                    ? props.nodes.some((n) => n.parentNodeId === props.hierarchyNodeDraft.id)
                    : false
                }
                lifecycleStatuses={props.lifecycleStatuses}
                badge={badge.badge}
                badgeOptions={badge.options}
                badgeSaving={badge.saving}
                validation={props.validation}
                saving={props.saving}
                onChange={props.onChangeHierarchyNode}
                onChangeProperty={props.onChangeHierarchyNodeProperty}
                onSave={async (options) => {
                  await props.onSaveHierarchyNode(options);
                  await badge.onSave();
                }}
                onSaveProperty={props.onSaveHierarchyModelNodeTypeProperty}
                onDeleteProperty={props.onDeleteHierarchyNodeProperty}
                onDelete={props.onDeleteHierarchyNode}
                onBadgeChange={badge.onChange}
                badgeDirty={badge.dirty}
                onBadgeReset={() => void badge.onReset()}
              />
            ),
          }}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <HierarchyRulesTable
          rows={props.rules}
          nodes={props.nodes}
        />
      </Grid>
    </Grid>
  );
}
