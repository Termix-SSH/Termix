import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginApiClient, TermixApp } from "@termix/plugin-sdk/frontend";
import {
  connectMeetings,
  meetingGuestUrl,
} from "../../src/frontend/meeting-backend";

function client(): PluginApiClient {
  return Object.fromEntries(
    ["get", "post", "put", "patch", "delete"].map((method) => [
      method,
      vi.fn(async () => ({ data: { rooms: [] } })),
    ]),
  ) as unknown as PluginApiClient;
}
afterEach(() => vi.restoreAllMocks());

describe("meeting backend", () => {
  it("routes rooms, invites and host resolution to the linked server and refuses a later switch", async () => {
    const local = client();
    const remote = client();
    let url: string | null = "https://termix.example/base/";
    const app = {
      desktop: { available: true, remoteServerUrl: async () => url },
      apiFor: (origin: string) => (origin === "remote" ? remote : local),
      t: (key: string) => key,
    } as unknown as TermixApp;
    const backend = await connectMeetings(app);
    expect(backend.origin).toBe("remote");
    await backend.api.listCollabRooms();
    await backend.api.createCollabRoom("Standup", true);
    await backend.api.getDirectory();
    await backend.api.resolveHost("stable-host-id");
    await backend.api.presentCollabStage("room", {
      hostId: 99,
      sessionId: "remote-session",
      protocol: "ssh",
    });
    expect(local.get).not.toHaveBeenCalled();
    expect(local.post).not.toHaveBeenCalled();
    expect(remote.get).toHaveBeenCalledWith("/meeting-host/stable-host-id");
    expect(remote.post).toHaveBeenCalledWith("/rooms/room/present", {
      hostId: 99,
      sessionId: "remote-session",
      protocol: "ssh",
    });
    expect(meetingGuestUrl(backend.publicUrl, "a+b&c")).toBe(
      "https://termix.example/base/?view=collab-guest&token=a%2Bb%26c",
    );
    url = "https://other.example";
    await expect(backend.api.deleteCollabRoom("room")).rejects.toThrow(
      "collab.serverChanged",
    );
    expect(remote.delete).not.toHaveBeenCalled();
    url = null;
    await expect(backend.api.getCollabRoom("room")).rejects.toThrow(
      "collab.serverChanged",
    );
  });

  it("keeps standalone rooms local without generating a file URL", async () => {
    const local = client();
    const backend = await connectMeetings({
      desktop: { available: true, remoteServerUrl: async () => null },
      apiFor: () => local,
      t: (key: string) => key,
    } as unknown as TermixApp);
    expect(backend.origin).toBe("local");
    await backend.api.listCollabRooms();
    expect(local.get).toHaveBeenCalledWith("/rooms");
    expect(meetingGuestUrl(backend.publicUrl, "token")).toBeNull();
    expect(meetingGuestUrl("file:///app/index.html", "token")).toBeNull();
  });

  it("preserves web deployment paths while replacing old query and fragment values", () => {
    expect(
      meetingGuestUrl("https://termix.example/app/?view=other#old", "token"),
    ).toBe("https://termix.example/app/?view=collab-guest&token=token");
  });
});
