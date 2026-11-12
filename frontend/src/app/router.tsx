import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/shared/layout/AppShell";
import { WorkspaceSectionLayout } from "@/shared/layout/WorkspaceSectionLayout";
import { NotFoundPage, RouteErrorPage } from "@/shared/layout/RouteErrorPage";
import { RequireAuth } from "@/features/auth/ui/RequireAuth";
import { RequireRole } from "@/features/auth/ui/RequireRole";
import { LoginPage } from "@/features/auth/ui/LoginPage";
import { ForgotPasswordPage } from "@/features/auth/ui/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ui/ResetPasswordPage";
import { AcceptInvitationPage } from "@/features/auth/ui/AcceptInvitationPage";
import { ROLE_ADMIN } from "@/shared/auth/roles";
import { ProfilePage } from "@/pages/ProfilePage";
import { AdminAuditPage } from "@/pages/AdminAuditPage";
import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { AdminRolesPage } from "@/pages/AdminRolesPage";
import { AdminRetentionPage } from "@/pages/AdminRetentionPage";
import { DiscoverMappingPage } from "@/pages/DiscoverMappingPage";
import { HomePage } from "@/pages/HomePage";
import { HomeTrialLauncherPage } from "@/pages/HomeTrialLauncherPage";
import { ImpactKnowledgeGraphPage } from "@/pages/ImpactKnowledgeGraphPage";
import { ImproveAttentionPage } from "@/pages/ImproveAttentionPage";
import { ImproveDashboardPage } from "@/pages/ImproveDashboardPage";
import { ImproveExportSummaryPage } from "@/pages/ImproveExportSummaryPage";
import { ImproveDemoStoryPackPage } from "@/pages/ImproveDemoStoryPackPage";
import { ImproveVerificationPage } from "@/pages/ImproveVerificationPage";
import { ImproveProgressTrackingPage } from "@/pages/ImproveProgressTrackingPage";
import { ImproveWorkProgramPage } from "@/pages/ImproveWorkProgramPage";
import { ModelTreeModelsPage } from "@/pages/ModelTreeModelsPage";
import { RulesPage } from "@/pages/RulesPage";
import { SettingsOrganisationPage } from "@/pages/SettingsOrganisationPage";
import { SettingsOwnershipPage } from "@/pages/SettingsOwnershipPage";
import { SettingsPreferencesPage } from "@/pages/SettingsPreferencesPage";
import { StructureDiagramPage } from "@/pages/StructureDiagramPage";
import { StructureMatrixPage } from "@/pages/StructureMatrixPage";
import { StructureTreePage } from "@/pages/StructureTreePage";

export const router = createBrowserRouter([
  // Reachable without signing in: the sign-in page itself and the links an
  // email brings someone to.
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage />, errorElement: <RouteErrorPage /> },
  { path: "/reset-password/:token", element: <ResetPasswordPage />, errorElement: <RouteErrorPage /> },
  { path: "/accept-invitation/:token", element: <AcceptInvitationPage />, errorElement: <RouteErrorPage /> },
  {
    // Everything else needs a signed-in, active account.
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
  {
    path: "/",
    element: <AppShell />,
    // A failure outside the pages themselves (the shell) still gets a way back.
    errorElement: <RouteErrorPage />,
    children: [
      {
        // A page that fails shows the error inside the shell, so the menu stays usable.
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <Navigate to="/home" replace /> },
          { path: "/home", element: <HomePage /> },
          { path: "/home/trial-launcher", element: <HomeTrialLauncherPage /> },
          { path: "/model/tree-models", element: <ModelTreeModelsPage /> },
          { path: "/structure-workspace", element: <StructureTreePage /> },
          { path: "/structure/diagram", element: <StructureDiagramPage /> },
          { path: "/structure/matrix", element: <StructureMatrixPage /> },
          // The session id is part of the address, so a reload, a bookmark or a
          // link reopens the same session. Optional rather than a second route:
          // the page stays mounted when a session is opened from the overview,
          // instead of unmounting and losing every in-flight query.
          { path: "/discover/mapping/:sessionId?", element: <DiscoverMappingPage /> },
          { path: "/rules", element: <RulesPage /> },
          { path: "/impact/knowledge-graph", element: <ImpactKnowledgeGraphPage /> },
          { path: "/improve/dashboard", element: <ImproveDashboardPage /> },
          { path: "/improve/attention", element: <ImproveAttentionPage /> },
          { path: "/improve/work-program", element: <ImproveWorkProgramPage /> },
          { path: "/improve/progress-tracking", element: <ImproveProgressTrackingPage /> },
          { path: "/improve/verification", element: <ImproveVerificationPage /> },
          { path: "/improve/export-summary", element: <ImproveExportSummaryPage /> },
          { path: "/improve/demo-story-pack", element: <ImproveDemoStoryPackPage /> },
          { path: "/profile", element: <ProfilePage /> },
          { path: "/settings/organisation", element: <SettingsOrganisationPage /> },
          { path: "/settings/preferences", element: <SettingsPreferencesPage /> },
          { path: "/settings/ownership", element: <SettingsOwnershipPage /> },
          // Admin's pages sit behind one tab bar. A layout route rather than a
          // line in each page: the bar is then impossible to forget when a page
          // is added, and the routes stay where everything else's routes are.
          {
            path: "/admin",
            // Only Admin users may open the Admin Workspace (PDP-251).
            element: <RequireRole role={ROLE_ADMIN} />,
            children: [
              {
            element: <WorkspaceSectionLayout section="admin" />,
            children: [
              { index: true, element: <Navigate to="/admin/users" replace /> },
              { path: "users", element: <AdminUsersPage /> },
              { path: "roles", element: <AdminRolesPage /> },
              { path: "retention", element: <AdminRetentionPage /> },
              { path: "audit", element: <AdminAuditPage /> }
            ]
              }
            ]
          },
          // Any other address.
          { path: "*", element: <NotFoundPage /> }
        ]
      }
    ]
  }
    ]
  }
]);
