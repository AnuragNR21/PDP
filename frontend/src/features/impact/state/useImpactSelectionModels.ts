import { useMemo } from "react";
import {
  CROSS_MODEL_SELECTION_LEVEL,
  type CrossModelSelectableItem,
  type CrossModelSelectionModel,
} from "@/features/cross-model";
import { useCrossModelSelectionModels } from "@/features/structure/state/useStructureWorkspace";
import {
  GOVERNANCE_ITEM_KIND,
  type GovernanceItem,
} from "@/features/structure/domain/structureGovernanceGraph";

/** The type id the injected model row carries, so the type filter can name it. */
export const MODEL_ROW_TYPE_ID = "__hierarchy_model__";
const MODEL_ROW_TYPE_NAME = "Hierarchy model";

/**
 * The same catalogue Structure's diagram offers, with the models themselves in it.
 *
 * Impact reads the graph one step above Structure: a whole hierarchy model is a
 * thing a reader can put on the canvas and open up, not only a container to
 * pick nodes out of. The panel lists a model's items, so the model is injected
 * as the root of its own tree and the real roots hang beneath it. Everything
 * else — the dropdowns, the scoped search, the badges, the tree — is Structure's
 * component unchanged, which is the point: two screens that look alike because
 * they are the same code, not because somebody kept them in step by hand.
 */
export function useImpactSelectionModels(): CrossModelSelectionModel[] {
  const models = useCrossModelSelectionModels();

  return useMemo(
    () =>
      models.map((model) => {
        if (model.modelKind !== "HIERARCHY_MODEL") return model;

        const modelRow: CrossModelSelectableItem = {
          id: `model:${model.id}`,
          name: model.name,
          level: CROSS_MODEL_SELECTION_LEVEL.INSTANCE,
          modelKind: model.modelKind,
          modelId: model.id,
          modelName: model.name,
          typeId: MODEL_ROW_TYPE_ID,
          typeName: MODEL_ROW_TYPE_NAME,
          parentId: null,
          badge: null,
        };

        return {
          ...model,
          items: [
            modelRow,
            // The model owns what used to be the top of the tree. Re-parenting
            // only the roots keeps every other parent link exactly as it was.
            ...model.items.map((item) =>
              item.parentId ? item : { ...item, parentId: modelRow.id },
            ),
          ],
        };
      }),
    [models],
  );
}

/**
 * A row from the selection panel, as the graph understands it.
 *
 * The panel speaks Structure's language and the canvas speaks the graph's, so
 * exactly one place translates. The server corrects anything approximate here
 * on the round trip that follows the add.
 */
export function toImpactItem(item: CrossModelSelectableItem): GovernanceItem {
  const isModel = item.typeId === MODEL_ROW_TYPE_ID;
  return {
    item_id: item.id,
    item_kind: isModel
      ? GOVERNANCE_ITEM_KIND.HIERARCHY_MODEL
      : item.modelKind === "HIERARCHY_MODEL"
        ? GOVERNANCE_ITEM_KIND.HIERARCHY_NODE
        : GOVERNANCE_ITEM_KIND.SUPPORT_DOMAIN_ELEMENT,
    name: item.name,
    status: "active",
    model_id: item.modelId,
    model_name: item.modelName,
    type_name: item.typeName,
    is_property: false,
    parent_id: item.parentId ?? null,
  };
}
