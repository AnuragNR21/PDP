/**
 * The tab bar across the top of a workspace that has more than one page.
 *
 * Built from the route manifest rather than a list of its own, so it cannot
 * fall behind the router — adding a page and forgetting to link it is how
 * /admin/retention ended up reachable only by typing the URL.
 */
import { Box, Tab, Tabs } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";

import { navLabelOf, sectionRoutes } from "@/app/routeManifest";

export function WorkspaceSubNav({ section }: { section: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const pages = sectionRoutes(section);

  if (pages.length < 2) return null;

  // An unknown path would make MUI drop the indicator and warn; falling back
  // to the first page keeps the bar looking deliberate on a stray URL.
  const current = pages.some((page) => page.route === location.pathname)
    ? location.pathname
    : pages[0].route;

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Tabs
        value={current}
        onChange={(_, route) => navigate(route)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, py: 0.5, textTransform: "none", fontSize: 15, fontWeight: 700 } }}
      >
        {pages.map((page) => (
          <Tab
            key={page.route}
            value={page.route}
            label={navLabelOf(page)}
          />
        ))}
      </Tabs>
    </Box>
  );
}
