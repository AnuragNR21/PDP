export interface ProjectionReferenceContract {
  projection_kind: string;
  projection_id: string;
  canonical_entity_kind: string;
  canonical_entity_id: string;
  model_id?: string | null;
  scope_id?: string | null;
}
