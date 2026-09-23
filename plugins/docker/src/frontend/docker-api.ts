import axios from "axios";
import { dockerApi, handleApiError } from "@/main-axios";
import type {
  DockerContainer,
  DockerLogOptions,
  DockerStats,
  DockerValidation,
} from "@/types/index";

type ApiConnectionLog = {
  type: "info" | "success" | "warning" | "error";
  stage: string;
  message: string;
  details?: Record<string, unknown>;
};

type ConnectErrorResponse = {
  error?: string;
  message?: string;
  connectionLogs?: ApiConnectionLog[];
  requires_totp?: boolean;
  requires_warpgate?: boolean;
  sessionId?: string;
  prompt?: string;
  url?: string;
  securityKey?: string;
  status?: string;
  reason?: string;
};

export async function connectDockerSession(
  sessionId: string,
  hostId: number,
  config?: {
    userProvidedPassword?: string;
    userProvidedSshKey?: string;
    userProvidedKeyPassword?: string;
    forceKeyboardInteractive?: boolean;
    useSocks5?: boolean;
    socks5Host?: string;
    socks5Port?: number;
    socks5Username?: string;
    socks5Password?: string;
    socks5ProxyChain?: unknown;
  },
): Promise<{
  success?: boolean;
  message?: string;
  requires_totp?: boolean;
  prompt?: string;
  isPassword?: boolean;
  status?: string;
  reason?: string;
  connectionLogs?: ApiConnectionLog[];
  requires_warpgate?: boolean;
  url?: string;
  securityKey?: string;
}> {
  try {
    const response = await dockerApi.post("/ssh/connect", {
      sessionId,
      hostId,
      ...config,
    });
    return response.data;
  } catch (error: unknown) {
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.status === "auth_required"
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.requires_totp
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.requires_warpgate
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.connectionLogs
    ) {
      const data = error.response.data;
      const errorWithLogs = new Error(
        data.error || data.message || error.message,
      );
      Object.assign(errorWithLogs, {
        connectionLogs: data.connectionLogs,
      });
      throw errorWithLogs;
    }
    throw handleApiError(error, "connect to Docker SSH session");
  }
}

export async function verifyDockerTOTP(
  sessionId: string,
  totpCode: string,
): Promise<{ status: string; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/connect-totp", {
      sessionId,
      totpCode,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "verify Docker TOTP");
  }
}

export async function verifyDockerWarpgate(
  sessionId: string,
): Promise<{ status: string; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/connect-warpgate", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "verify Docker Warpgate");
  }
}

export async function disconnectDockerSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/disconnect", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "disconnect from Docker SSH session");
  }
}

export async function keepaliveDockerSession(
  sessionId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await dockerApi.post("/ssh/keepalive", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "keepalive Docker SSH session");
  }
}

export async function getDockerSessionStatus(
  sessionId: string,
): Promise<{ success: boolean; connected: boolean }> {
  try {
    const response = await dockerApi.get("/ssh/status", {
      params: { sessionId },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get Docker session status");
  }
}

export async function validateDockerAvailability(
  sessionId: string,
): Promise<DockerValidation> {
  try {
    const response = await dockerApi.get(`/validate/${sessionId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "validate Docker availability");
  }
}

export async function listDockerContainers(
  sessionId: string,
  all: boolean = true,
): Promise<DockerContainer[]> {
  try {
    const response = await dockerApi.get(`/containers/${sessionId}`, {
      params: { all },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "list Docker containers");
  }
}

export async function getDockerContainerDetails(
  sessionId: string,
  containerId: string,
): Promise<DockerContainer> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get Docker container details");
  }
}

export async function startDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/start`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "start Docker container");
  }
}

export async function stopDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/stop`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "stop Docker container");
  }
}

export async function restartDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/restart`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "restart Docker container");
  }
}

export async function pauseDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/pause`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "pause Docker container");
  }
}

export async function unpauseDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/unpause`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "unpause Docker container");
  }
}

export async function removeDockerContainer(
  sessionId: string,
  containerId: string,
  force: boolean = false,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.delete(
      `/containers/${sessionId}/${containerId}/remove`,
      {
        params: { force },
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove Docker container");
  }
}

export async function getContainerLogs(
  sessionId: string,
  containerId: string,
  options?: DockerLogOptions,
): Promise<{ logs: string }> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/logs`,
      {
        params: options,
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get container logs");
  }
}

export async function downloadContainerLogs(
  sessionId: string,
  containerId: string,
  options?: DockerLogOptions,
): Promise<Blob> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/logs`,
      {
        params: { ...options, download: true },
        responseType: "blob",
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "download container logs");
  }
}

export async function getContainerStats(
  sessionId: string,
  containerId: string,
): Promise<DockerStats> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/stats`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get container stats");
  }
}
