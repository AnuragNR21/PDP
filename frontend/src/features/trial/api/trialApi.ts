import { apiClient } from "@/shared/http/apiClient";

export interface TrialScenarioCard {
  scenario_code: string;
  title: string;
  persona: string;
  route: string;
  summary: string;
}

export interface TrialHomePayload {
  guided_mode: boolean;
  scenarios: TrialScenarioCard[];
  known_limitations: string[];
  next_steps: string[];
}

export interface TrialSummary {
  total_events: number;
  total_feedback: number;
  next_step_counts: Record<string, number>;
  top_scenarios: Array<{ scenario_code: string; count: number }>;
}

export const trialApi = {
  getHome: () => apiClient.get<TrialHomePayload>("/trial/home"),
  getSummary: () => apiClient.get<{ summary: TrialSummary }>("/trial/summary"),
  createEvent: (body: {
    event_type: string;
    scenario_code: string;
    user_label: string;
    object_ref?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  }) => apiClient.post<{ event: { event_id: string } }>("/trial/events", body),
  createFeedback: (body: {
    scenario_code: string;
    usefulness_score: number;
    trust_score: number;
    ease_score: number;
    next_step: string;
    notes: string;
  }) => apiClient.post<{ feedback: { feedback_id: string } }>("/trial/feedback", body),
  reset: () => apiClient.post<{ status: string }>("/trial/reset", {}),
  reseed: () => apiClient.post<{ status: string }>("/trial/reseed", {})
};
