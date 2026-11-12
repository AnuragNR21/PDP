/**
 * A workspace's pages behind one tab bar.
 *
 * Used as a layout route so every page of the section gets the bar without
 * each page having to remember to render it.
 */
import { Stack } from "@mui/material";
import { Outlet } from "react-router-dom";

import { WorkspaceSubNav } from "./WorkspaceSubNav";

export function WorkspaceSectionLayout({ section }: { section: string }) {
  return (
    <Stack spacing={1}>
      <WorkspaceSubNav section={section} />
      <Outlet />
    </Stack>
  );
}
