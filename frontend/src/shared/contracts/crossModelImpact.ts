export type CrossModelRelationshipDeleteImpact = {
  relationshipId: string;
  relationshipTypeName: string;
  sourceInstanceName: string;
  targetInstanceName: string;
};

export type CrossModelRelationshipDeleteImpactDto = {
  relationship_id: string;
  relationship_type_name: string;
  source_instance_name: string;
  target_instance_name: string;
};

export type CrossModelRelationshipImpact = {
  impact_summary: {
    relationship_count: number;
  };
  impact_list_items: CrossModelRelationshipDeleteImpactDto[];
};

export type CrossModelRelationshipTypeDeleteImpactSummaryDto = {
  relationship_type_id: string;
  relationship_type_name: string;
  relationship_count: number;
};

export type CrossModelRelationshipTypeDeleteImpactDto = {
  impact_summary: CrossModelRelationshipTypeDeleteImpactSummaryDto;
  impact_list_items: CrossModelRelationshipDeleteImpactDto[];
};

export const mapCrossModelRelationshipDeleteImpacts = (
  relationships: CrossModelRelationshipDeleteImpactDto[] = [],
): CrossModelRelationshipDeleteImpact[] =>
  relationships.map((relationship) => ({
    relationshipId: relationship.relationship_id,
    relationshipTypeName: relationship.relationship_type_name,
    sourceInstanceName: relationship.source_instance_name,
    targetInstanceName: relationship.target_instance_name,
  }));

