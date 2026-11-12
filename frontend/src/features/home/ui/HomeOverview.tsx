import { OverflowText } from "@/shared/workspace/OverflowText";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DeviceHubOutlinedIcon from "@mui/icons-material/DeviceHubOutlined";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useMemo, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useHomeOverview } from "@/features/home/state/useHomeOverview";
import { useHierarchyModels, useSupportDomainModels } from "@/features/structure/state/useStructureWorkspace";
import { RelationshipDetailsList } from "@/shared/workspace/RelationshipDetailsList";
import { SidePanel } from "@/shared/workspace/SidePanel";
import { ModelKindIcon } from "@/shared/workspace/WorkspaceIcons";
import { AuthoringPanel, WorkspaceBody, useStoredFlag } from "@/shared/workspace/WorkspacePanels";
import { useRecentModels } from "@/shared/workspace/useRecentModels";
import { MODEL_KIND_LABEL, WORKSPACE_ROUTE, type WorkspaceKind, type WorkspaceModel } from "@/shared/workspace/workspaceModel";

const WORKSPACES: Array<{ label: string; description: string; route: string; icon: ReactElement }> = [
  { label: "Model (MWS)", description: "Define models and the relationships they allow", route: "/model/tree-models", icon: <LanOutlinedIcon /> },
  { label: "Structure (SWS)", description: "Manage instances and their relationships", route: "/structure-workspace", icon: <DeviceHubOutlinedIcon /> },
  { label: "Discover", description: "Profile and check source data", route: "/discover/mapping", icon: <ExploreOutlinedIcon /> },
  { label: "Rules", description: "Govern data quality rules", route: "/rules", icon: <GavelOutlinedIcon /> },
  { label: "Impact", description: "Read what a change would reach", route: "/impact/knowledge-graph", icon: <InsightsOutlinedIcon /> },
  { label: "Improve", description: "Plan and verify remediation", route: "/improve/dashboard", icon: <DashboardOutlinedIcon /> },
];

/**
 * Home, on the layout the workspaces share: navigation, a selection panel on
 * the left (here, the workspaces to launch), a header card, the main panel
 * (the overview and recent models) and two details sections (alerts and
 * recent activity).
 */
export function HomeOverview() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useHomeOverview();
  const [panelCollapsed, setPanelCollapsed] = useStoredFlag("pdp-home-workspaces-collapsed", false);
  const hierarchy = useHierarchyModels();
  const support = useSupportDomainModels();
  const mwsRecent = useRecentModels("mws").recent;
  const swsRecent = useRecentModels("sws").recent;

  const recentModels = useMemo(() => {
    const models = new Map<string, WorkspaceModel>();
    for (const m of hierarchy.data ?? []) models.set(m.id, { id: m.id, kind: "hierarchy", name: m.name, description: m.purpose, status: m.status });
    for (const m of support.data ?? []) models.set(m.id, { id: m.id, kind: "support", name: m.name, description: m.purpose, status: m.status });
    const merged = [
      ...mwsRecent.map((ref) => ({ ...ref, workspace: "mws" as WorkspaceKind })),
      ...swsRecent.map((ref) => ({ ...ref, workspace: "sws" as WorkspaceKind })),
    ].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return merged
      .map((ref) => ({ ref, model: models.get(ref.id) }))
      .filter((entry): entry is { ref: (typeof merged)[number]; model: WorkspaceModel } => Boolean(entry.model))
      .slice(0, 6);
  }, [hierarchy.data, support.data, mwsRecent, swsRecent]);

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 520, display: "flex" }}>
      <Stack direction="row" alignItems="center" sx={{ borderBottom: 1, borderColor: "divider", minHeight: 40 }}>
        <Tabs value="overview" sx={{ minHeight: 40, flex: 1, "& .MuiTab-root": { minHeight: 40, py: 0.5, textTransform: "none", fontSize: 15, fontWeight: 700 } }}>
          <Tab value="overview" label="Overview" />
        </Tabs>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
        <SidePanel title="Workspaces" collapsed={panelCollapsed} onToggle={() => setPanelCollapsed(!panelCollapsed)} width={280}>
          <List dense disablePadding sx={{ overflow: "auto" }}>
            {WORKSPACES.map((workspace) => (
              <ListItemButton key={workspace.route} onClick={() => navigate(workspace.route)} sx={{ borderRadius: 1, alignItems: "flex-start" }}>
                <ListItemIcon sx={{ minWidth: 36, mt: 0.5, color: "primary.main" }}>{workspace.icon}</ListItemIcon>
                <ListItemText primary={workspace.label} secondary={workspace.description} primaryTypographyProps={{ fontWeight: 600, variant: "body2" }} secondaryTypographyProps={{ variant: "caption" }} />
              </ListItemButton>
            ))}
          </List>
        </SidePanel>

        <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <Paper variant="outlined" sx={{ px: 2, py: 1.25, flexShrink: 0 }}>
            <Stack direction="row" spacing={1.75} alignItems="center">
              <Avatar variant="rounded" sx={{ width: 38, height: 38, bgcolor: "primary.main" }}>
                <HomeOutlinedIcon />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <OverflowText variant="subtitle1" fontWeight={700} >
                  Power Data Platform
                </OverflowText>
                <OverflowText variant="body2" color="text.secondary" >
                  Overview, alerts, and quick launch into governed PDP work.
                </OverflowText>
              </Box>
              <Stack direction="row" spacing={2} sx={{ display: { xs: "none", md: "flex" } }}>
                {(data?.cards ?? []).map((card) => (
                  <Box key={card.key} sx={{ textAlign: "right" }}>
                    <Typography variant="subtitle2" fontWeight={700} lineHeight={1.2}>
                      {card.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {card.title}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Paper>

          {isError && <Alert severity="error">Unable to load Home overview.</Alert>}

          <WorkspaceBody
            storageKey="home-overview"
            authoring={
              <AuthoringPanel title="Overview Workspace" hint="Where governed work stands, and the models you opened last">
                {isLoading ? (
                  <Box sx={{ py: 6, display: "flex", justifyContent: "center" }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <Stack spacing={2.5}>
                    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                      {(data?.cards ?? []).map((card) => (
                        <Card key={card.key} variant="outlined">
                          <CardActionArea onClick={() => navigate(card.handoff.destination_route)} sx={{ p: 1.5, height: "100%" }}>
                            <Stack spacing={0.5}>
                              <Stack direction="row" alignItems="center" justifyContent="space-between">
                                <Typography variant="overline" color="text.secondary" lineHeight={1.4}>
                                  {card.title}
                                </Typography>
                                <ArrowOutwardIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                              </Stack>
                              <Typography variant="h5" fontWeight={700}>
                                {card.value}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {card.description}
                              </Typography>
                            </Stack>
                          </CardActionArea>
                        </Card>
                      ))}
                    </Box>
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Recent models
                      </Typography>
                      {recentModels.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          Models you open in MWS or SWS appear here.
                        </Typography>
                      ) : (
                        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", mt: 1 }}>
                          {recentModels.map(({ ref, model }) => (
                            <Card key={`${ref.workspace}:${model.id}`} variant="outlined">
                              <CardActionArea
                                onClick={() => navigate(`${WORKSPACE_ROUTE[ref.workspace]}?kind=${model.kind}&model=${encodeURIComponent(model.id)}`)}
                                sx={{ p: 1.5, height: "100%" }}
                              >
                                <Stack direction="row" spacing={1.5} alignItems="center">
                                  <ModelKindIcon kind={model.kind} size={32} />
                                  <Box sx={{ minWidth: 0 }}>
                                    <OverflowText variant="subtitle2" fontWeight={700} >
                                      {model.name}
                                    </OverflowText>
                                    <OverflowText variant="caption" color="text.secondary" display="block">
                                      {MODEL_KIND_LABEL[model.kind]} · {ref.workspace.toUpperCase()}
                                    </OverflowText>
                                  </Box>
                                </Stack>
                              </CardActionArea>
                            </Card>
                          ))}
                        </Box>
                      )}
                    </Box>
                  </Stack>
                )}
              </AuthoringPanel>
            }
            element={{
              title: "Alerts",
              isEmpty: (data?.alerts ?? []).length === 0,
              empty: isLoading ? "Loading…" : "No alerts.",
              content: (
                <Stack spacing={1}>
                  {(data?.alerts ?? []).map((alert) => (
                    <Alert
                      key={alert.alert_id}
                      severity={alert.severity === "info" ? "info" : "warning"}
                      action={
                        <Button color="inherit" size="small" onClick={() => navigate(alert.handoff.destination_route)}>
                          Open
                        </Button>
                      }
                      sx={{ py: 0 }}
                    >
                      <strong>{alert.title}</strong> — {alert.description}
                    </Alert>
                  ))}
                </Stack>
              ),
            }}
            relationship={{
              title: "Recent Activity",
              isEmpty: (data?.recent_activity ?? []).length === 0,
              empty: isLoading ? "Loading…" : "No recent activity.",
              content: (
                <RelationshipDetailsList
                  groups={[
                    {
                      title: "Latest",
                      items: (data?.recent_activity ?? []).map((item) => ({
                        key: item.activity_id,
                        label: item.title,
                        secondary: `${item.description} · ${item.audit.occurred_at}`,
                        relation: String(item.workspace),
                      })),
                    },
                  ]}
                />
              ),
            }}
          />
        </Stack>
      </Box>
    </Stack>
  );
}
