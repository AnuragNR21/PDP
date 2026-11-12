"""
The words the structure governance graph is made of, in one place.

A *kind* here is a wire value: it is written into SQL, sent to the browser in
every item and edge, and saved inside a diagram's rows. Spelling it as a
literal at each use is how `"support_domain"` becomes `"support-domain"` in one
query and nothing matches any more — a failure that shows up as an edge
silently missing from a picture, not as an error.

So the repository, the service and the API all read these names from here, and
the frontend's `structure/domain/structureGovernanceGraph.ts` keeps the same
strings on its side. The two lists are a contract: change one and you change
the other.

**Graph** and **diagram** are not synonyms here, and the constants below belong
to the graph:

* The **graph** is the governance itself — every node instance, every element
  instance, and every relationship Structure asserts between them. It is one
  thing, it is shared, nobody owns it, and this module never writes to it. Kinds
  are its vocabulary.
* A **diagram** is one person's saved *reading* of that graph: the handful of
  items they put on a canvas, where they dragged them, under a name. Many
  diagrams, each owned by whoever saved it, none of them authoritative. Delete
  every diagram and the graph is untouched; retire a node in Structure and every
  diagram that showed it is out of date.

So `structure_governance_graph_repository` reads the graph, `impact_diagram_repository` stores
diagrams, and a diagram's rows hold only *ids* — never a relationship of
their own, because a drawing cannot assert governance.
"""
from __future__ import annotations

from shared.model_config import HIERARCHY_MODEL, HIERARCHY_NODE, SUPPORT_DOMAIN_ELEMENT

# ── what can sit on the canvas ───────────────────────────────────────────────
#
# Items use the app's own model vocabulary (`shared.model_config`): a hierarchy
# model, a hierarchy node, a support domain element. They are the same concepts
# the rest of the app already names, so they are not redefined here.

ITEM_KINDS: tuple[str, ...] = (
    HIERARCHY_MODEL,
    HIERARCHY_NODE,
    SUPPORT_DOMAIN_ELEMENT,
)

#: A hierarchy model is a model, not a node instance, so its id has to come
#: from somewhere that cannot collide with one. The prefix is that somewhere.
MODEL_ITEM_PREFIX = "model:"


def model_item_id(model_id: str) -> str:
    """The canvas id for a hierarchy model."""
    return f"{MODEL_ITEM_PREFIX}{model_id}"


# ── what can join two of them ────────────────────────────────────────────────

#: A node instance and its parent, inside one hierarchy model — and a model to
#: the root nodes it holds.
EDGE_HIERARCHY = "hierarchy"

#: A node instance governed by a Support Domain element instance.
EDGE_CROSS_MODEL = "cross_model"

#: Two element instances whose element *types* are related. Projected, never
#: asserted: the relationship is authored between types, so it says nothing
#: about which individual values relate. Always sent with `asserted: False`.
EDGE_SUPPORT_DOMAIN = "support_domain"

EDGE_KINDS: tuple[str, ...] = (
    EDGE_HIERARCHY,
    EDGE_CROSS_MODEL,
    EDGE_SUPPORT_DOMAIN,
)
