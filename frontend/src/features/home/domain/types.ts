import {
  AuditStamp,
  NavigationHandoffContract,
  WorkspaceCode,
  WorkspaceContextContract
} from "@/shared/contracts";

export interface HomeOverviewCard {
  key: string;
  title: string;
  value: string;
  description: string;
  handoff: NavigationHandoffContract;
}

export interface RecentActivityItem {
  activity_id: string;
  title: string;
  description: string;
  workspace: WorkspaceCode;
  context: WorkspaceContextContract;
  audit: AuditStamp;
}

export interface AlertSummaryItem {
  alert_id: string;
  severity: string;
  title: string;
  description: string;
  handoff: NavigationHandoffContract;
}

export interface HomeOverviewResponse {
  workspace: WorkspaceCode;
  cards: HomeOverviewCard[];
  alerts: AlertSummaryItem[];
  recent_activity: RecentActivityItem[];
}
