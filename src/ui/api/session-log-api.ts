import { authApi, handleApiError } from "@/main-axios";

export type SessionLogRecord = {
  id: number;
  hostId: number;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  recordingPath: string | null;
  hostName: string | null;
  hostIp: string | null;
  sizeBytes: number | null;
  protocol: "ssh" | "rdp" | "vnc" | "telnet";
  format: "text" | "asciicast" | "guacamole";
  username: string | null;
};

export async function getSessionLogs(): Promise<SessionLogRecord[]> {
  try {
    const response = await authApi.get("/session_logs/");
    return response.data.logs;
  } catch (error) {
    throw handleApiError(error, "fetch session logs");
  }
}

export async function getSessionLogBlob(id: number): Promise<Blob> {
  try {
    const response = await authApi.get(`/session_logs/${id}/content`, {
      responseType: "blob",
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch session recording");
  }
}

export async function getSessionRecordingRetention(): Promise<number> {
  try {
    const response = await authApi.get("/session_logs/retention");
    return response.data.retentionDays;
  } catch (error) {
    throw handleApiError(error, "fetch session recording retention");
  }
}

export async function setSessionRecordingRetention(
  retentionDays: number,
): Promise<void> {
  try {
    await authApi.put("/session_logs/retention", { retentionDays });
  } catch (error) {
    throw handleApiError(error, "update session recording retention");
  }
}

export async function getSessionLogContent(id: number): Promise<string> {
  try {
    const response = await authApi.get(`/session_logs/${id}/content`, {
      responseType: "text",
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch session log content");
  }
}

export async function deleteSessionLog(id: number): Promise<void> {
  try {
    await authApi.delete(`/session_logs/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete session log");
  }
}
