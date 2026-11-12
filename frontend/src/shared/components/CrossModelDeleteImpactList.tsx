import { Chip, Divider, List, ListItem, ListItemText, Typography } from '@mui/material';
import type {
  CrossModelRelationshipDeleteImpact,
  CrossModelRelationshipDeleteImpactDto,
} from '@/shared/contracts/crossModelImpact';

type CrossModelRelationshipImpactListItem =
  | CrossModelRelationshipDeleteImpact
  | CrossModelRelationshipDeleteImpactDto;

const getRelationshipId = (relationship: CrossModelRelationshipImpactListItem) =>
  'relationshipId' in relationship ? relationship.relationshipId : relationship.relationship_id;

const getRelationshipTypeName = (relationship: CrossModelRelationshipImpactListItem) =>
  'relationshipTypeName' in relationship ? relationship.relationshipTypeName : relationship.relationship_type_name;

const getSourceInstanceName = (relationship: CrossModelRelationshipImpactListItem) =>
  'sourceInstanceName' in relationship ? relationship.sourceInstanceName : relationship.source_instance_name;

const getTargetInstanceName = (relationship: CrossModelRelationshipImpactListItem) =>
  'targetInstanceName' in relationship ? relationship.targetInstanceName : relationship.target_instance_name;

export function CrossModelDeleteImpactList(props: {
  relationships: CrossModelRelationshipImpactListItem[];
}) {
  if (props.relationships.length === 0) return null;

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" gutterBottom>
        Relationships that will be removed
        <Chip label={props.relationships.length} size="small" color="warning" sx={{ ml: 1 }} />
      </Typography>
      <List dense disablePadding>
        {props.relationships.map((relationship) => (
          <ListItem key={getRelationshipId(relationship)} disableGutters sx={{ py: 0.25 }}>
            <ListItemText
              primary={`${getSourceInstanceName(relationship)} -> ${getTargetInstanceName(relationship)}`}
              secondary={getRelationshipTypeName(relationship)}
            />
          </ListItem>
        ))}
      </List>
    </>
  );
}
