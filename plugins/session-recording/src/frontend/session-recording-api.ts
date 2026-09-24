import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export type SessionLogRecord = {
  id: number;
  hostId: number;
  userId: string | null;
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

export function createSessionRecordingApi(api: PluginApiClient) {
  return {
    async list(): Promise<SessionLogRecord[]> {
      const response = await api.get<{ logs: SessionLogRecord[] }>("/");
      return response.data.logs;
    },

    async getBlob(id: number): Promise<Blob> {
      const response = await api.get<Blob>(`/${id}/content`, {
        responseType: "blob",
      });
      return response.data;
    },

    async getContent(id: number): Promise<string> {
      const response = await api.get<string>(`/${id}/content`, {
        responseType: "text",
      });
      return response.data;
    },

    async delete(id: number): Promise<void> {
      await api.delete(`/${id}`);
    },
  };
}
