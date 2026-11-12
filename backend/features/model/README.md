# PDP Model Workspace Backend Pack

This package is a **full replacement** for the previously attached backend `model` package.

## What this replacement adds
- exact two-surface backend support for **Hierarchy Model** and **Support Domain** authoring
- persistent data contracts for:
  - Hierarchy Models
  - Structural Nodes
  - Structural Rules
  - Support Domain Models
  - Support Domain Elements
  - Support Domain Relationships
- automatic schema bootstrap for SQLite when these tables do not already exist
- automatic Hierarchy Rule maintenance when hierarchy tree parent-child links are created or changed
- metadata endpoint so frontend configuration does **not depend on hard-coded local option values**

## Key routes
- `GET /api/model/metadata`
- `GET/POST/PUT/DELETE /api/model/hierarchy-models`
- `GET /api/model/hierarchy-tree/{model_id}`
- `GET/POST/PUT/DELETE /api/model/hierarchy-nodes`
- `GET/POST/PUT/DELETE /api/model/hierarchy-rules`
- `GET/POST/PUT/DELETE /api/model/support-domain-models`
- `GET/POST/PUT/DELETE /api/model/support-domain-elements`
- `GET/POST/PUT/DELETE /api/model/support-domain-relationships`

## Replacement note
These files are intended to replace the backend files in the attached `model` package **file-for-file**, not as line patches.
