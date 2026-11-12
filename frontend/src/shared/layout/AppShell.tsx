import ChevronLeftOutlinedIcon from "@mui/icons-material/ChevronLeftOutlined";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DeviceHubOutlinedIcon from "@mui/icons-material/DeviceHubOutlined";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import TagOutlinedIcon from "@mui/icons-material/TagOutlined";
import {
  AppBar,
  Avatar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Toolbar,
  Tooltip,
  Typography
} from "@mui/material";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { GlobalSearch } from "@/features/search/ui/GlobalSearch";
import { useAuth } from "@/features/auth/state/AuthContext";
import { roleLabel } from "@/shared/auth/roles";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import { Divider, ListItemIcon as MenuItemIcon } from "@mui/material";

const DRAWER_WIDTH = 240;
const COLLAPSED_WIDTH = 80;
const TRANSITION = "width 0.22s cubic-bezier(0.4,0,0.2,1)";
const LS_KEY = "pdp-nav-collapsed";

const workspaceNav = [
  { label: "Home", route: "/home", icon: <HomeOutlinedIcon /> },
  // MWS and SWS: the two workspaces that share one layout (PDP-UIUX-001).
  { label: "Model (MWS)", route: "/model/tree-models", icon: <LanOutlinedIcon /> },
  { label: "Structure (SWS)", route: "/structure-workspace", icon: <DeviceHubOutlinedIcon /> },
  { label: "Discover", route: "/discover/mapping", icon: <ExploreOutlinedIcon /> },
  { label: "Rules", route: "/rules", icon: <GavelOutlinedIcon /> },
  { label: "Impact", route: "/impact/knowledge-graph", icon: <InsightsOutlinedIcon /> },
  { label: "Improve", route: "/improve/dashboard", icon: <DashboardOutlinedIcon /> },
  { label: "Settings", route: "/settings/organisation", icon: <SettingsOutlinedIcon /> },
  // /admin redirects to its first page, so the sidebar does not have to know
  // which page that is.
  { label: "Admin", route: "/admin", icon: <ManageAccountsOutlinedIcon />, adminOnly: true }
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, logout } = useAuth();
  // Admin is not in the menu for people who cannot open it (PDP-251).
  const visibleNav = workspaceNav.filter((item) => !item.adminOnly || isAdmin);
  const displayName = user?.display_name || user?.email || "";
  const avatarInitial = (displayName.trim()[0] ?? "?").toUpperCase();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null);
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null);

  const toggle = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(LS_KEY, String(!prev));
      } catch {
        // Not remembered; the menu still folds.
      }
      return !prev;
    });
  };

  const drawerWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: `calc(100% - ${drawerWidth}px)`,
          ml: `${drawerWidth}px`,
          borderBottom: "1px solid",
          borderColor: "divider",
          transition: TRANSITION,
        }}
      >
        <Toolbar sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Tooltip title="Landing page">
            <IconButton size="small" onClick={() => navigate("/home")} aria-label="Landing page" sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}>
              <TagOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="h6" component="div" noWrap sx={{ display: { xs: "none", lg: "block" } }}>
            Power Data Platform
          </Typography>
          <Box sx={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <GlobalSearch />
          </Box>
          <Tooltip title="Help">
            <IconButton size="small" onClick={(event) => setHelpAnchor(event.currentTarget)} aria-label="Help">
              <HelpOutlineOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => navigate("/settings/preferences")} aria-label="Settings">
              <SettingsOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={displayName || "Account"}>
            <IconButton size="small" onClick={(event) => setUserAnchor(event.currentTarget)} aria-label="Account">
              <Avatar sx={{ width: 28, height: 28, fontSize: 14, bgcolor: "success.light" }}>{avatarInitial}</Avatar>
            </IconButton>
          </Tooltip>
          <Box
            component="img"
            src="/pdp-logo.png"
            alt="PDP Logo"
            sx={{ height: 40, width: 40, objectFit: "contain" }}
          />
        </Toolbar>
        <Popover
          open={Boolean(helpAnchor)}
          anchorEl={helpAnchor}
          onClose={() => setHelpAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <Stack spacing={1} sx={{ p: 2, maxWidth: 360 }}>
            <Typography variant="subtitle2" fontWeight={700}>Workspaces</Typography>
            <Typography variant="body2" color="text.secondary">
              <b>MWS</b> (Model Workspace) defines models: hierarchy node types, support domain element types and the relationships allowed between them.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <b>SWS</b> (Structure Workspace) manages the instances of those models and the actual relationships between them, checked against the model.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Both use Model · Relationship · Data Exchange, then Hierarchy, Diagram, Matrix or List. Select something to see its Element Details and Relationship Details; ⛶ shows the authoring workspace full screen.
            </Typography>
          </Stack>
        </Popover>
        <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)}>
          <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
            <Typography variant="subtitle2" fontWeight={700} noWrap>{displayName}</Typography>
            {user?.email && user.email !== displayName ? (
              <Typography variant="caption" color="text.secondary" noWrap display="block">{user.email}</Typography>
            ) : null}
            {user?.roles.length ? (
              <Typography variant="caption" color="text.secondary" display="block">
                {user.roles.map(roleLabel).join(" · ")}
              </Typography>
            ) : null}
          </Box>
          <Divider />
          <MenuItem onClick={() => { setUserAnchor(null); navigate("/profile"); }}>
            <MenuItemIcon><PersonOutlineOutlinedIcon fontSize="small" /></MenuItemIcon>
            My Profile
          </MenuItem>
          <MenuItem onClick={() => { setUserAnchor(null); navigate("/settings/preferences"); }}>
            <MenuItemIcon><SettingsOutlinedIcon fontSize="small" /></MenuItemIcon>
            Preferences
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setUserAnchor(null); void logout().then(() => navigate("/login", { replace: true })); }}>
            <MenuItemIcon><LogoutOutlinedIcon fontSize="small" /></MenuItemIcon>
            Log out
          </MenuItem>
        </Menu>
      </AppBar>

      {/* Drawer + floating toggle wrapper */}
      <Box sx={{ position: "relative", flexShrink: 0, width: drawerWidth, transition: TRANSITION }}>
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            transition: TRANSITION,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
              overflowX: "hidden",
              transition: TRANSITION,
            }
          }}
        >
          {/* Brand */}
          {collapsed ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 1.5 }}>
              <Typography variant="h6" fontWeight={700}>PDP</Typography>
            </Box>
          ) : (
            <Toolbar sx={{ display: "flex", alignItems: "center", px: 2, minHeight: 64 }}>
              <Box sx={{ overflow: "hidden", minWidth: 0 }}>
                <Typography variant="h6" noWrap>PDP</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "normal", lineHeight: 1.3, fontWeight: 600 }}>
                  A Data Intelligence Platform for Power Utilities
                </Typography>
              </Box>
            </Toolbar>
          )}

          {/* Nav items */}
          <List sx={{ px: collapsed ? 0.5 : 1, pt: 0 }}>
            {visibleNav.map((item) => {
              const isActive = location.pathname.startsWith(
                item.route.split("/")[1] ? `/${item.route.split("/")[1]}` : item.route
              );
              return (
                <Tooltip key={item.route} title={collapsed ? item.label : ""} placement="right">
                  <ListItemButton
                    selected={isActive}
                    onClick={() => navigate(item.route)}
                    sx={{
                      borderRadius: 2,
                      mb: 0.5,
                      justifyContent: collapsed ? "center" : "flex-start",
                      px: collapsed ? 1 : 2,
                      minHeight: 44,
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        mr: collapsed ? 0 : 1.5,
                        justifyContent: "center",
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {!collapsed && <ListItemText primary={item.label} />}
                  </ListItemButton>
                </Tooltip>
              );
            })}
          </List>
        </Drawer>

        {/* Floating toggle button — sits on the divider line, near the top */}
        <Tooltip title={collapsed ? "Expand menu" : "Collapse menu"} placement="right">
          <IconButton
            onClick={toggle}
            size="small"
            sx={{
              position: "fixed",
              top: 18,
              left: drawerWidth,
              transform: "translateX(-50%)",
              transition: `left ${TRANSITION}`,
              zIndex: (theme) => theme.zIndex.drawer + 1,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              width: 28,
              height: 28,
              boxShadow: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            {collapsed ? <ChevronRightOutlinedIcon sx={{ fontSize: 20 }} /> : <ChevronLeftOutlinedIcon sx={{ fontSize: 20 }} />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, transition: TRANSITION, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <Toolbar />
        {/* Half the padding at the top: the page heading sits right under the app
            bar, so the full 24px there only pushed content down the screen. */}
        <Box sx={{ px: 3, pb: 3, pt: 1.5, flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
