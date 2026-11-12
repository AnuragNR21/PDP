import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import type { SupportDomainRelationshipSummary } from "@/features/model/domain/types";
import type { ElementInstance, ElementRelationshipInstance } from "@/features/structure/api/structureApi";
import {
  useCreateElementRelationshipInstance,
  useDeleteElementRelationshipInstance,
} from "@/features/structure/state/useStructureWorkspace";
import { useToast } from "@/shared/toast/ToastContext";
import { relationshipKindLabel } from "@/features/cross-model";

/**
 * Links drawn on the SWS Support Domain Diagram / Matrix. They are
 * diagram-only (support_domain_element_instance_relationship_diagram_edges): the relationships themselves are
 * inherited from the model (see ./sdFollowedRelationships), and drawing or
 * removing a link never changes those. A drawn link must still follow the
 * model — one relationship it defines between the two instances' element
 * types, in that direction.
 */
/** Named exactly as the Model Workspace names the relationship ("Applicable to", "Categorises", …). */
export { relationshipKindLabel } from "@/features/cross-model";

/** Model relationships new links may be made with: only Active ones (lifecycle rule). */
export function linkableRelationships(relationships: SupportDomainRelationshipSummary[]) {
  return relationships.filter((rel) => rel.status === "active");
}

const linkKey = (relId: string, sourceId: string, targetId: string) => `${relId}|${sourceId}|${targetId}`;

export function linkKeys(links: ElementRelationshipInstance[]) {
  return new Set(links.map((link) => linkKey(link.support_domain_relationship_id, link.source_instance_id, link.target_instance_id)));
}

/** The relationships that could still link `source` → `target`. */
export function applicableRelationships(
  relationships: SupportDomainRelationshipSummary[],
  existing: Set<string>,
  source: ElementInstance,
  target: ElementInstance,
) {
  if (source.instance_id === target.instance_id) return [];
  // An Archived instance stays in the links it has, but takes no new ones.
  if (source.status === "retired" || target.status === "retired") return [];
  return linkableRelationships(relationships).filter(
    (rel) =>
      rel.sourceElementId === source.element_type_id &&
      rel.targetElementId === target.element_type_id &&
      !existing.has(linkKey(rel.id, source.instance_id, target.instance_id)),
  );
}

/** Every instance `source` may still be linked to, by any relationship. */
export function validTargetIds(
  relationships: SupportDomainRelationshipSummary[],
  existing: Set<string>,
  instances: ElementInstance[],
  source: ElementInstance,
) {
  const ids = new Set<string>();
  for (const target of instances) {
    if (applicableRelationships(relationships, existing, source, target).length > 0) ids.add(target.instance_id);
  }
  return ids;
}

/** Links per model relationship, for the counts in List and the header. */
export function countByRelationship(links: ElementRelationshipInstance[]) {
  const counts = new Map<string, number>();
  for (const link of links) counts.set(link.support_domain_relationship_id, (counts.get(link.support_domain_relationship_id) ?? 0) + 1);
  return counts;
}

function errorDetail(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? (error instanceof Error ? error.message : fallback);
}

type Choice = { source: ElementInstance; target: ElementInstance; options: SupportDomainRelationshipSummary[] };

/**
 * Creating and removing instance links, shared by every projection: one
 * applicable relationship is used straight away, several are offered to
 * choose from, and a removal is confirmed first.
 */
export function useInstanceLinkAuthoring(props: {
  relationships: SupportDomainRelationshipSummary[];
  links: ElementRelationshipInstance[];
  typeName: (typeId: string) => string;
}) {
  const { showToast } = useToast();
  const create = useCreateElementRelationshipInstance();
  const remove = useDeleteElementRelationshipInstance();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [removing, setRemoving] = useState<ElementRelationshipInstance | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const save = async (rel: SupportDomainRelationshipSummary, source: ElementInstance, target: ElementInstance) => {
    try {
      await create.mutateAsync({ support_domain_relationship_id: rel.id, source_instance_id: source.instance_id, target_instance_id: target.instance_id });
      showToast(`${source.name} → ${relationshipKindLabel(rel.relationshipKind)} → ${target.name}.`);
    } catch (error) {
      showToast(errorDetail(error, "Could not draw the link."), "error");
    }
  };

  /** `onlyRelationshipId` narrows the choice to one relationship, e.g. when the Matrix is filtered to it. */
  const link = (source: ElementInstance, target: ElementInstance, onlyRelationshipId?: string) => {
    const options = applicableRelationships(props.relationships, linkKeys(props.links), source, target).filter(
      (rel) => !onlyRelationshipId || rel.id === onlyRelationshipId,
    );
    if (options.length === 0) {
      showToast(
        `The model defines no relationship from ${props.typeName(source.element_type_id)} to ${props.typeName(target.element_type_id)} that these two do not already have.`,
        "error",
      );
      return;
    }
    if (options.length === 1) void save(options[0], source, target);
    else setChoice({ source, target, options });
  };

  const confirmRemove = (target: ElementRelationshipInstance) => {
    setRemoveError(null);
    setRemoving(target);
  };

  const element: ReactNode = (
    <>
      <Dialog open={Boolean(choice)} onClose={() => setChoice(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Choose the relationship</DialogTitle>
        <DialogContent>
          {choice && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                The model relates {props.typeName(choice.source.element_type_id)} to {props.typeName(choice.target.element_type_id)} in {choice.options.length} ways. Which one links these two?
              </Typography>
              <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                {choice.options.map((rel) => (
                  <ListItemButton
                    key={rel.id}
                    onClick={() => {
                      const { source, target } = choice;
                      setChoice(null);
                      void save(rel, source, target);
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>{choice.source.name}</Typography>
                          <Typography variant="body2" fontWeight={700} sx={{ flexShrink: 0 }}>{relationshipKindLabel(rel.relationshipKind)}</Typography>
                          <ArrowForwardIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
                          <Typography variant="body2" noWrap>{choice.target.name}</Typography>
                        </Stack>
                      }
                      secondary={rel.notes || undefined}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChoice(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(removing)} onClose={remove.isPending ? undefined : () => setRemoving(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Remove diagram link</DialogTitle>
        <DialogContent>
          {removeError && <Alert severity="error" sx={{ mb: 1.5 }}>{removeError}</Alert>}
          {removing && (
            <Typography variant="body2">
              Remove “{removing.source_instance_name} {relationshipKindLabel(removing.relationship_type)} {removing.target_instance_name}”? The drawn link is removed from the Diagram and Matrix. The inherited relationship, the instances and the model are not changed.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)} disabled={remove.isPending}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={async () => {
              if (!removing) return;
              try {
                await remove.mutateAsync(removing.relationship_instance_id);
                showToast("Diagram link removed.");
                setRemoving(null);
              } catch (error) {
                setRemoveError(errorDetail(error, "Could not remove the diagram link."));
              }
            }}
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return { link, remove: confirmRemove, element, creating: create.isPending };
}
