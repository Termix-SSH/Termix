import { aiApp } from "./app-ref";

/** Fired when the AI status may have changed, so every surface re-reads it. */
export const AI_STATUS_CHANGED_EVENT = "termix-ai:status-changed";

export function notifyAiStatusChanged(): void {
  window.dispatchEvent(new Event(AI_STATUS_CHANGED_EVENT));
}

/** The server's own message when it sent one, so the user sees why. */
function apiError(error: unknown, action: string): Error {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  if (typeof data?.error === "string" && data.error) {
    return new Error(data.error);
  }
  if (error instanceof Error && error.message) return error;
  return new Error(`Failed to ${action}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Response bodies are typed per function below, at the edge.
interface LooseClient {
  get(url: string): Promise<{ data: any }>;
  delete(url: string): Promise<{ data: any }>;
  post(url: string, body?: unknown): Promise<{ data: any }>;
  put(url: string, body?: unknown): Promise<{ data: any }>;
  patch(url: string, body?: unknown): Promise<{ data: any }>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const api = () => aiApp().api as unknown as LooseClient;

export type AiProviderType =
  "ollama" | "anthropic" | "openai" | "gemini" | "openai_compatible";

export interface AiProvider {
  id: number;
  providerType: AiProviderType;
  label: string;
  baseUrl: string | null;
  /** The first few characters only; the key itself never leaves the server. */
  apiKeyPrefix: string | null;
  defaultModel: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface AiConversation {
  id: number;
  title: string | null;
  providerId: number | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: string | null;
  createdAt: string;
}

export interface AiProposal {
  id: number;
  conversationId: number;
  kind: string;
  summary: string | null;
  payload: string;
  status: "pending" | "applied" | "rejected" | "expired";
  resultSummary: string | null;
  createdAt: string;
}

export interface AiStatus {
  globallyEnabled: boolean;
  enabled: boolean;
  allowReadOnlyCommands: boolean;
}

export async function getAiStatus(): Promise<AiStatus> {
  try {
    return (await api().get("/status")).data;
  } catch (error) {
    throw apiError(error, "get AI status");
  }
}

export async function getAiProviders(): Promise<AiProvider[]> {
  try {
    return (await api().get("/providers")).data.providers;
  } catch (error) {
    throw apiError(error, "list AI providers");
  }
}

export async function createAiProvider(input: {
  providerType: AiProviderType;
  label: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  defaultModel?: string | null;
}): Promise<AiProvider> {
  try {
    return (await api().post("/providers", input)).data.provider;
  } catch (error) {
    throw apiError(error, "create AI provider");
  }
}

export async function updateAiProvider(
  id: number,
  input: Partial<{
    label: string;
    baseUrl: string | null;
    apiKey: string | null;
    defaultModel: string | null;
    enabled: boolean;
  }>,
): Promise<AiProvider> {
  try {
    return (await api().patch(`/providers/${id}`, input)).data.provider;
  } catch (error) {
    throw apiError(error, "update AI provider");
  }
}

export async function deleteAiProvider(id: number): Promise<void> {
  try {
    await api().delete(`/providers/${id}`);
  } catch (error) {
    throw apiError(error, "delete AI provider");
  }
}

/**
 * Model list for a provider that may not be saved yet, so the add form can
 * fill its picker before anything is persisted.
 */
export async function probeAiModels(input: {
  providerType: AiProviderType;
  baseUrl?: string | null;
  apiKey?: string | null;
  providerId?: number | null;
}): Promise<{
  models: string[];
  source: "live" | "fallback" | "none";
  warning?: string;
}> {
  try {
    return (await api().post("/probe-models", input)).data;
  } catch (error) {
    throw apiError(error, "detect models");
  }
}

export async function getAiProviderModels(id: number): Promise<string[]> {
  try {
    return (await api().get(`/providers/${id}/models`)).data.models;
  } catch (error) {
    throw apiError(error, "list provider models");
  }
}

export async function getAiConversations(): Promise<AiConversation[]> {
  try {
    return (await api().get("/conversations")).data.conversations;
  } catch (error) {
    throw apiError(error, "list AI conversations");
  }
}

export async function getAiConversation(id: number): Promise<{
  conversation: AiConversation;
  messages: AiMessage[];
  proposals: AiProposal[];
}> {
  try {
    return (await api().get(`/conversations/${id}`)).data;
  } catch (error) {
    throw apiError(error, "load AI conversation");
  }
}

export async function deleteAiConversation(id: number): Promise<void> {
  try {
    await api().delete(`/conversations/${id}`);
  } catch (error) {
    throw apiError(error, "delete AI conversation");
  }
}

export async function applyAiProposal(
  id: number,
): Promise<{ success: boolean; summary: string }> {
  try {
    return (await api().post(`/proposals/${id}/apply`)).data;
  } catch (error) {
    throw apiError(error, "apply AI proposal");
  }
}

export async function rejectAiProposal(id: number): Promise<void> {
  try {
    await api().post(`/proposals/${id}/reject`);
  } catch (error) {
    throw apiError(error, "reject AI proposal");
  }
}

/**
 * For the terminal-docked assistant: records that a run_command proposal was
 * typed into the user's open terminal instead of run over a pooled connection.
 */
export async function markAiProposalRunInTerminal(
  id: number,
  hostId: number,
  summary?: string,
): Promise<{ success: boolean; summary: string }> {
  try {
    return (
      await api().post(`/proposals/${id}/mark-run-in-terminal`, {
        hostId,
        summary,
      })
    ).data;
  } catch (error) {
    throw apiError(error, "mark AI proposal run in terminal");
  }
}

/** Turns the assistant on or off for the current user. */
export async function setAiOptIn(enabled: boolean): Promise<void> {
  try {
    await api().put("/opt-in", { enabled });
  } catch (error) {
    throw apiError(error, "update the AI setting");
  } finally {
    notifyAiStatusChanged();
  }
}
