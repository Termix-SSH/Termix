import { useMemo } from "react";
import {
  usePluginApi,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
import type { ConnectionStage } from "@termix/plugin-sdk/ui";
import type {
  DockerContainer,
  DockerLogOptions,
  DockerStats,
  DockerValidation,
} from "./types";

export interface ApiConnectionLog {
  type: "info" | "success" | "warning" | "error";
  stage: ConnectionStage;
  message: string;
  details?: string;
}

/** One step of a connect: connected, a prompt to answer, or auth needed. */
export interface ConnectResult {
  success?: boolean;
  status?: string;
  reason?: string;
  message?: string;
  requires_totp?: boolean;
  prompt?: string;
  isPassword?: boolean;
  retry?: boolean;
  requires_warpgate?: boolean;
  url?: string | null;
  securityKey?: string;
  connectionLogs?: ApiConnectionLog[];
}

/** An API failure carrying the server's message and connection logs. */
export class DockerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly connectionLogs?: ApiConnectionLog[],
  ) {
    super(message);
    this.name = "DockerApiError";
  }
}

function apiError(error: unknown, action: string): DockerApiError {
  const response = (
    error as {
      response?: {
        status?: number;
        data?: {
          error?: string;
          message?: string;
          connectionLogs?: ApiConnectionLog[];
        };
      };
    }
  )?.response;
  const data = response?.data;
  const message =
    data?.error ||
    data?.message ||
    (error instanceof Error ? error.message : `Failed to ${action}`);
  return new DockerApiError(message, response?.status, data?.connectionLogs);
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

export type ContainerAction =
  "start" | "stop" | "restart" | "pause" | "unpause";

export function createDockerApi(api: PluginApiClient) {
  return {
    connect: (
      sessionId: string,
      hostId: number,
      credentials?: {
        userProvidedPassword?: string;
        userProvidedSshKey?: string;
        userProvidedKeyPassword?: string;
      },
    ) =>
      call<ConnectResult>("connect to Docker", () =>
        api.post("/ssh/connect", { sessionId, hostId, ...credentials }),
      ),

    answerTotp: (sessionId: string, totpCode: string) =>
      call<ConnectResult>("verify the code", () =>
        api.post("/ssh/connect-totp", { sessionId, totpCode }),
      ),

    continueWarpgate: (sessionId: string) =>
      call<ConnectResult>("complete Warpgate authentication", () =>
        api.post("/ssh/connect-warpgate", { sessionId }),
      ),

    disconnect: (sessionId: string) =>
      call("disconnect from Docker", () =>
        api.post("/ssh/disconnect", { sessionId }),
      ),

    keepalive: (sessionId: string) =>
      call("keep the Docker session alive", () =>
        api.post("/ssh/keepalive", { sessionId }),
      ),

    validate: (sessionId: string) =>
      call<DockerValidation>("validate Docker", () =>
        api.get(`/validate/${sessionId}`),
      ),

    listContainers: (sessionId: string, all = true) =>
      call<DockerContainer[]>("list containers", () =>
        api.get(`/containers/${sessionId}`, { params: { all } }),
      ),

    containerAction: (
      sessionId: string,
      containerId: string,
      action: ContainerAction,
    ) =>
      call<{ success: boolean; message: string }>(
        `${action} the container`,
        () => api.post(`/containers/${sessionId}/${containerId}/${action}`),
      ),

    removeContainer: (sessionId: string, containerId: string, force = false) =>
      call<{ success: boolean; message: string }>("remove the container", () =>
        api.delete(`/containers/${sessionId}/${containerId}/remove`, {
          params: { force },
        }),
      ),

    logs: (
      sessionId: string,
      containerId: string,
      options?: DockerLogOptions,
    ) =>
      call<{ logs: string }>("load container logs", () =>
        api.get(`/containers/${sessionId}/${containerId}/logs`, {
          params: options,
        }),
      ),

    stats: (sessionId: string, containerId: string) =>
      call<DockerStats>("load container stats", () =>
        api.get(`/containers/${sessionId}/${containerId}/stats`),
      ),
  };
}

export type DockerApi = ReturnType<typeof createDockerApi>;

/** The Docker API on this plugin's own client. */
export function useDockerApi(): DockerApi {
  const api = usePluginApi();
  return useMemo(() => createDockerApi(api), [api]);
}
