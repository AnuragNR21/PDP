import assert from "node:assert/strict";
import { routeManifest } from "@/app/routeManifest";

const criticalRoutes = [
  "/home",
  "/structure-workspace",
  "/discover/mapping",
  "/impact/knowledge-graph",
  "/improve/dashboard",
  "/improve/attention",
  "/improve/verification",
  "/settings/preferences",
  "/admin/users",
  "/admin/roles",
  "/admin/audit"
];

for (const route of criticalRoutes) {
  assert.ok(routeManifest.some((entry) => entry.route === route), `Missing critical route: ${route}`);
}

assert.equal(
  routeManifest.filter((entry) => entry.smoke === "covered").length,
  routeManifest.length,
  "All Increment 12 routes should be marked covered in the smoke manifest."
);
