import type { CrossModelRelationshipTypeDraft, MetadataOption, SupportDomainElementSummary, SupportDomainRelationshipDraft } from '../../domain/types';
import { displayLabel } from '../../domain/utils';
import { CreateEditCrossModelRelationshipTypeDialog } from './CreateEditCrossModelRelationshipTypeDialog';

const EMPTY_TYPE_OPTIONS = { nodeTypes: [], elementTypes: [] };
/** Containment kinds belong to hierarchies, not to Support Domain relationships. */
const NOT_FOR_SUPPORT_DOMAIN = new Set(['parent_child', 'recursive']);

/**
 * A relationship between two element types of one Support Domain model, in the
 * same editor as the Relationship Diagram (Support Domain mode). The name is a
 * relationship kind or a name of the model's own ("zz 123", stored as typed);
 * the description is kept as the notes, and both ends are element types of this
 * model.
 */
export function CreateEditSupportDomainRelationshipDialog(props: {
  open: boolean;
  draft: SupportDomainRelationshipDraft;
  elements: SupportDomainElementSummary[];
  relationshipKinds: MetadataOption[];
  lifecycleStatuses: MetadataOption[];
  modelName?: string;
  /** The model's relationships, to offer the names it already uses. */
  relationships?: Array<{ id: string; relationshipKind: string }>;
  validation: Record<string, string>;
  saving: boolean;
  onChange: (patch: Partial<SupportDomainRelationshipDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const kinds = props.relationshipKinds.filter((k) => !NOT_FOR_SUPPORT_DOMAIN.has(k.key));
  // A kind shows as its label; a name of the model's own shows as typed.
  const labelOf = (key: string) => kinds.find((k) => k.key === key)?.label ?? key;
  const kindKeys = new Set(props.relationshipKinds.map((k) => k.key));
  const existingNames = new Map<string, { name: string; uses: number }>();
  for (const rel of props.relationships ?? []) {
    if (rel.id === props.draft.id || kindKeys.has(rel.relationshipKind)) continue;
    const key = rel.relationshipKind.trim().toLocaleLowerCase();
    const seen = existingNames.get(key);
    if (seen) seen.uses += 1;
    else existingNames.set(key, { name: rel.relationshipKind.trim(), uses: 1 });
  }

  const draft: CrossModelRelationshipTypeDraft = {
    id: props.draft.id,
    name: labelOf(props.draft.relationshipKind),
    description: props.draft.notes,
    sourceModelType: 'SUPPORT_DOMAIN_MODEL',
    sourceModelItemTypeId: props.draft.sourceElementId || null,
    targetModelType: 'SUPPORT_DOMAIN_MODEL',
    targetModelItemTypeId: props.draft.targetElementId || null,
    status: props.draft.status,
  };

  const change = (patch: Partial<CrossModelRelationshipTypeDraft>) => {
    const next: Partial<SupportDomainRelationshipDraft> = {};
    if (patch.name !== undefined) {
      const typed = patch.name;
      next.relationshipKind = kinds.find((k) => k.label.toLocaleLowerCase() === typed.trim().toLocaleLowerCase())?.key ?? typed;
    }
    if (patch.description !== undefined) next.notes = patch.description;
    if (patch.sourceModelItemTypeId !== undefined) next.sourceElementId = patch.sourceModelItemTypeId ?? '';
    if (patch.targetModelItemTypeId !== undefined) next.targetElementId = patch.targetModelItemTypeId ?? '';
    if (patch.status !== undefined) next.status = patch.status;
    props.onChange(next);
  };

  const validation: Record<string, string> = {};
  if (props.validation.relationshipKind) validation.name = props.validation.relationshipKind;
  if (props.validation.sourceElementId) validation.source = props.validation.sourceElementId;
  if (props.validation.targetElementId) validation.target = props.validation.targetElementId;
  if (props.validation.status) validation.status = props.validation.status;

  return (
    <CreateEditCrossModelRelationshipTypeDialog
      open={props.open}
      draft={draft}
      typeOptions={EMPTY_TYPE_OPTIONS}
      lifecycleStatuses={props.lifecycleStatuses}
      validation={validation}
      saving={props.saving}
      supportDomain={{
        modelName: props.modelName || 'this model',
        elements: props.elements.map((e) => ({ id: e.id, name: displayLabel(e) })),
        kinds,
        existingNames: [...existingNames.values()],
      }}
      onChange={change}
      onSave={props.onSave}
      onDelete={props.draft.id && props.onDelete ? () => { props.onDelete!(); props.onClose(); } : undefined}
      onClose={props.onClose}
    />
  );
}
