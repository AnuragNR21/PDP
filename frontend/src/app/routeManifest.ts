export interface RouteManifestEntry {
  route: string;
  title: string;
  smoke: "covered" | "pending";
  /**
   * The short label a section's tab bar shows. Optional: without it the tab
   * falls back to the title with its workspace word stripped, which is right
   * often enough that only the awkward ones need spelling out.
   */
  navLabel?: string;
}

export const routeManifest: RouteManifestEntry[] = [
  { route: "/home", title: "Home", smoke: "covered" },
  { route: "/home/trial-launcher", title: "Trial Launcher", smoke: "covered" },
  { route: "/model/tree-models", title: "Model Tree Models", smoke: "covered" },
  { route: "/structure-workspace", title: "Structure Workspace", smoke: "covered" },
  { route: "/structure/diagram", title: "Structure Diagram", smoke: "covered" },
  { route: "/structure/matrix", title: "Structure Matrix", smoke: "covered" },
  { route: "/discover/mapping", title: "Discover Mapping", smoke: "covered" },
  { route: "/rules", title: "Rule Workspace", smoke: "covered" },
  { route: "/impact/knowledge-graph", title: "Impact Knowledge Graph", smoke: "covered" },
  { route: "/improve/dashboard", title: "Improve Dashboard", smoke: "covered" },
  { route: "/improve/attention", title: "Improve Attention", smoke: "covered" },
  { route: "/improve/work-program", title: "Improve Work Program", smoke: "covered" },
  { route: "/improve/progress-tracking", title: "Improve Progress Tracking", smoke: "covered" },
  { route: "/improve/verification", title: "Improve Verification", smoke: "covered" },
  { route: "/improve/export-summary", title: "Improve Export Summary", smoke: "covered" },
  { route: "/improve/demo-story-pack", title: "Improve Demo Story Pack", smoke: "covered" },
  { route: "/profile", title: "My Profile", smoke: "covered" },
  { route: "/settings/organisation", title: "Settings Organisation", smoke: "covered" },
  { route: "/settings/preferences", title: "Settings Preferences", smoke: "covered" },
  { route: "/settings/ownership", title: "Settings Ownership", smoke: "covered" },
  { route: "/admin/users", title: "Admin Users", smoke: "covered", navLabel: "Users" },
  { route: "/admin/roles", title: "Admin Roles & Permissions", smoke: "covered", navLabel: "Roles & permissions" },
  { route: "/admin/retention", title: "Admin Data Retention", smoke: "covered", navLabel: "Data retention" },
  { route: "/admin/audit", title: "Admin Audit Log", smoke: "covered", navLabel: "Audit log" }
];

/** The first path segment — "/admin/audit" belongs to the section "admin". */
export function sectionOf(route: string): string {
  return route.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Every page of one section, in the order the manifest lists them.
 *
 * The manifest is the one place a route is written down, so a tab bar built
 * from it cannot fall behind the router: adding a page and forgetting to link
 * it — which is how /admin/retention was reachable only by typing the URL —
 * stops being possible.
 */
export function sectionRoutes(section: string): RouteManifestEntry[] {
  return routeManifest.filter((entry) => sectionOf(entry.route) === section);
}

/** The tab label: the explicit one, else the title minus its workspace word. */
export function navLabelOf(entry: RouteManifestEntry): string {
  if (entry.navLabel) return entry.navLabel;
  const section = sectionOf(entry.route);
  const stripped = entry.title.replace(new RegExp(`^${section}\\s+`, "i"), "");
  return stripped || entry.title;
}
