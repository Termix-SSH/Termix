import { authApi, handleApiError } from "@/main-axios";

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
    return (await authApi.get("/ai/status")).data;
  } catch (error) {
    throw handleApiError(error, "get AI status");
  }
}

export async function getAiProviders(): Promise<AiProvider[]> {
  try {
    return (await authApi.get("/ai/providers")).data.providers;
  } catch (error) {
    throw handleApiError(error, "list AI providers");
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
    return (await authApi.post("/ai/providers", input)).data.provider;
  } catch (error) {
    throw handleApiError(error, "create AI provider");
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
    return (await authApi.patch(`/ai/providers/${id}`, input)).data.provider;
  } catch (error) {
    throw handleApiError(error, "update AI provider");
  }
}

export async function deleteAiProvider(id: number): Promise<void> {
  try {
    await authApi.delete(`/ai/providers/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete AI provider");
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
    return (await authApi.post("/ai/probe-models", input)).data;
  } catch (error) {
    throw handleApiError(error, "detect models");
  }
}

export async function getAiProviderModels(id: number): Promise<string[]> {
  try {
    return (await authApi.get(`/ai/providers/${id}/models`)).data.models;
  } catch (error) {
    throw handleApiError(error, "list provider models");
  }
}

export async function getAiConversations(): Promise<AiConversation[]> {
  try {
    return (await authApi.get("/ai/conversations")).data.conversations;
  } catch (error) {
    throw handleApiError(error, "list AI conversations");
  }
}

export async function getAiConversation(id: number): Promise<{
  conversation: AiConversation;
  messages: AiMessage[];
  proposals: AiProposal[];
}> {
  try {
    return (await authApi.get(`/ai/conversations/${id}`)).data;
  } catch (error) {
    throw handleApiError(error, "load AI conversation");
  }
}

export async function deleteAiConversation(id: number): Promise<void> {
  try {
    await authApi.delete(`/ai/conversations/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete AI conversation");
  }
}

export async function applyAiProposal(
  id: number,
): Promise<{ success: boolean; summary: string }> {
  try {
    return (await authApi.post(`/ai/proposals/${id}/apply`)).data;
  } catch (error) {
    throw handleApiError(error, "apply AI proposal");
  }
}

export async function rejectAiProposal(id: number): Promise<void> {
  try {
    await authApi.post(`/ai/proposals/${id}/reject`);
  } catch (error) {
    throw handleApiError(error, "reject AI proposal");
  }
}

// --- admin ---

export async function getAiGloballyEnabled(): Promise<boolean> {
  try {
    return (await authApi.get("/users/ai-enabled")).data.enabled;
  } catch (error) {
    throw handleApiError(error, "get AI enabled setting");
  }
}

export async function setAiGloballyEnabled(enabled: boolean): Promise<boolean> {
  try {
    return (await authApi.patch("/users/ai-enabled", { enabled })).data.enabled;
  } catch (error) {
    throw handleApiError(error, "update AI enabled setting");
  }
}

export async function getAiPrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/ai-private-endpoints")).data.hosts;
  } catch (error) {
    throw handleApiError(error, "get AI endpoint allowlist");
  }
}

export async function setAiPrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (await authApi.patch("/users/ai-private-endpoints", { hosts })).data
      .hosts;
  } catch (error) {
    throw handleApiError(error, "update AI endpoint allowlist");
  }
}

export async function getNotificationPrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/notification-private-endpoints")).data
      .hosts;
  } catch (error) {
    throw handleApiError(error, "get notification endpoint allowlist");
  }
}

export async function getStepCaPrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/step-ca-private-endpoints")).data.hosts;
  } catch (error) {
    throw handleApiError(error, "get Step CA endpoint allowlist");
  }
}

export async function setStepCaPrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (await authApi.patch("/users/step-ca-private-endpoints", { hosts }))
      .data.hosts;
  } catch (error) {
    throw handleApiError(error, "update Step CA endpoint allowlist");
  }
}

export async function setNotificationPrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (
      await authApi.patch("/users/notification-private-endpoints", { hosts })
    ).data.hosts;
  } catch (error) {
    throw handleApiError(error, "update notification endpoint allowlist");
  }
}
