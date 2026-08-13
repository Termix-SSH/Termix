import { authApi, handleApiError } from "@/main-axios";
import type {
  AutomationDefinition,
  ConcurrencyPolicy,
  RunStatus,
  StepStatus,
  StepType,
  TriggerKind,
} from "@/types/automations";

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

export async function listAutomations(): Promise<AutomationRow[]> {
  try {
    return (await authApi.get("/automations")).data;
  } catch (error) {
    throw handleApiError(error, "fetch automations");
  }
}

export async function getAutomation(id: number): Promise<AutomationRow> {
  try {
    return (await authApi.get(`/automations/${id}`)).data;
  } catch (error) {
    throw handleApiError(error, "fetch automation");
  }
}

export async function createAutomation(
  input: AutomationInput,
): Promise<AutomationRow> {
  try {
    return (await authApi.post("/automations", input)).data;
  } catch (error) {
    throw handleApiError(error, "create automation");
  }
}

export async function updateAutomation(
  id: number,
  input: Partial<AutomationInput>,
): Promise<AutomationRow> {
  try {
    return (await authApi.put(`/automations/${id}`, input)).data;
  } catch (error) {
    throw handleApiError(error, "update automation");
  }
}

export async function deleteAutomation(id: number): Promise<void> {
  try {
    await authApi.delete(`/automations/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete automation");
  }
}

export async function runAutomation(
  id: number,
  options: { dryRun?: boolean } = {},
): Promise<AutomationRunOutcome> {
  try {
    return (await authApi.post(`/automations/${id}/run`, options)).data;
  } catch (error) {
    throw handleApiError(error, "run automation");
  }
}

export async function listAutomationRuns(
  options: { automationId?: number; limit?: number; offset?: number } = {},
): Promise<AutomationRunRow[]> {
  try {
    return (await authApi.get("/automations/runs/history", { params: options }))
      .data;
  } catch (error) {
    throw handleApiError(error, "fetch automation runs");
  }
}

export async function listAutomationRunSteps(
  runId: number,
): Promise<AutomationRunStepRow[]> {
  try {
    return (await authApi.get(`/automations/runs/${runId}/steps`)).data;
  } catch (error) {
    throw handleApiError(error, "fetch run steps");
  }
}
