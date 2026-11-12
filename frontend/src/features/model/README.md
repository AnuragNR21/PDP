# Model workspace frontend replacement

This package is a full-file replacement set for the frontend `model` feature.

Key changes:
- exactly two tabs: Structural Model and Support Domain
- persistent left navigation listing both Structural Models and Support Domain Models
- no local hard-coded lifecycle/domain/relationship option lists; options load from `/api/model/metadata`
- Structural Model tree authoring wired to backend structural node endpoints
- Structural Rules loaded from backend and maintained by backend tree mutations
- Support Domain model, element, and relationship authoring wired to backend endpoints

Important:
- treat all files in this package as full replacements
- remove overlapping legacy editors from the consuming application if they are referenced elsewhere
