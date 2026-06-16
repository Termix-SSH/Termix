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
};

export async function getSessionLogs(): Promise<SessionLogRecord[]> {
  try {
    const response = await authApi.get("/session_logs/");
    return response.data.logs;
  } catch (error) {
    throw handleApiError(error, "fetch session logs");
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
