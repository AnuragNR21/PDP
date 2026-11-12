/**
 * Every route the smoke suite walks.
 *
 * This list and `src/app/routeManifest.ts` must hold exactly the same routes;
 * `routeManifest.spec.mjs` fails if they drift. They are two files because
 * `node --test` cannot import TypeScript, not because they are two ideas.
 */
export const routeCatalog = [
  "/home",
  "/home/trial-launcher",
  "/model/tree-models",
  "/structure-workspace",
  "/structure/diagram",
  "/structure/matrix",
  "/discover/mapping",
  "/rules",
  "/impact/knowledge-graph",
  "/improve/dashboard",
  "/improve/attention",
  "/improve/work-program",
  "/improve/progress-tracking",
  "/improve/verification",
  "/improve/export-summary",
  "/improve/demo-story-pack",
  "/profile",
  "/settings/organisation",
  "/settings/preferences",
  "/settings/ownership",
  "/admin/users",
  "/admin/roles",
  "/admin/retention",
  "/admin/audit"
];
