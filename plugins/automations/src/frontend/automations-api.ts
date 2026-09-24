import { useMemo } from "react";
import {
  usePluginApi,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
import type {
  AutomationDefinition,
  ConcurrencyPolicy,
  RunStatus,
  StepStatus,
  StepType,
  TriggerKind,
} from "../types";

export interface AutomationRow {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  enabled: number;
  definition: AutomationDefinition | null;
  definition_version: number;
  concurrency_policy: ConcurrencyPolicy;
  max_run_seconds: number;
  dry_run: number;
  last_run_at: string | null;
  last_run_status: RunStatus | null;
  created_at: string;
  updated_at: string;
  channels: number[];
  /** Plugins this automation needs that are not running. */
  missingPlugins?: string[];
  /** Returned once, only when a webhook automation is created. */
  webhookToken?: string;
}

export interface AutomationRunRow {
  id: number;
  automation_id: number;
  user_id: string;
  trigger_type: TriggerKind | "manual";
  trigger_context: string | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  dry_run: number;
  parent_run_id: number | null;
  automation_name?: string | null;
}

export interface AutomationRunStepRow {
  id: number;
  run_id: number;
  step_index: number;
  step_id: string;
  step_type: StepType;
  status: StepStatus;
  started_at: string;
  finished_at: string | null;
  output: string | null;
  error: string | null;
  truncated: number;
}

export interface AutomationRunOutcome {
  runId: number | null;
  status: RunStatus;
  error?: string;
}

export interface AutomationInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  definition: AutomationDefinition;
  concurrencyPolicy?: ConcurrencyPolicy;
  channels?: number[];
}

/** Which optional plugins are running, keyed like the backend's deps. */
export interface AutomationProviders {
  snippets: boolean;
  fleets: boolean;
  tunnels: boolean;
  docker: boolean;
  "docker-events": boolean;
  "host-metrics": boolean;
  "wake-on-lan": boolean;
}

export interface AutomationEditorOptionsResponse {
  hosts: Array<{ id: number; name: string }>;
  snippets: Array<{ id: number; name: string }>;
  fleets: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  providers: AutomationProviders;
}

function apiError(error: unknown, action: string): Error {
  const data = (
    error as { response?: { data?: { error?: string; message?: string } } }
  )?.response?.data;
  return new Error(
    data?.error ||
      data?.message ||
      (error instanceof Error ? error.message : `Failed to ${action}`),
  );
}

async function call<T>(
  action: string,
  request: () => Promise<{ data: T }>,
): Promise<T> {
  try {
    return (await request()).data;
  } catch (error) {
    throw apiError(error, action);
  }
}

export function createAutomationsApi(api: PluginApiClient) {
  return {
    list: () => call<AutomationRow[]>("fetch automations", () => api.get("/")),
    editorOptions: () =>
      call<AutomationEditorOptionsResponse>("fetch editor options", () =>
        api.get("/editor-options"),
      ),
    create: (input: AutomationInput) =>
      call<AutomationRow>("create automation", () => api.post("/", input)),
    update: (id: number, input: Partial<AutomationInput>) =>
      call<AutomationRow>("update automation", () => api.put(`/${id}`, input)),
    remove: (id: number) =>
      call<{ success: boolean }>("delete automation", () =>
        api.delete(`/${id}`),
      ),
    run: (id: number, options: { dryRun?: boolean } = {}) =>
      call<AutomationRunOutcome>("run automation", () =>
        api.post(`/${id}/run`, options),
      ),
    runs: (
      options: { automationId?: number; limit?: number; offset?: number } = {},
    ) =>
      call<AutomationRunRow[]>("fetch automation runs", () =>
        api.get("/runs/history", { params: options }),
      ),
    runSteps: (runId: number) =>
      call<AutomationRunStepRow[]>("fetch run steps", () =>
        api.get(`/runs/${runId}/steps`),
      ),
  };
}

export type AutomationsApi = ReturnType<typeof createAutomationsApi>;

export function useAutomationsApi(): AutomationsApi {
  const api = usePluginApi();
  return useMemo(() => createAutomationsApi(api), [api]);
}
