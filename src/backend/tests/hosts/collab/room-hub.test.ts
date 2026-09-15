import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const runtime = vi.hoisted(() => ({
  listener: null as ((roomId: string, message: object) => void) | null,
  publish: vi.fn(async () => undefined),
  updatePresence: vi.fn(async () => undefined),
}));

vi.mock("../../../hosts/collab/runtime-store.js", () => ({
  collabRuntimeStore: {
    onEvent: (listener: (roomId: string, message: object) => void) => {
      runtime.listener = listener;
    },
    publish: runtime.publish,
    updatePresence: runtime.updatePresence,
    onlineUsers: async (
      _roomId: string,
      users: Array<{ userId: string; username: string }>,
    ) => users,
  },
}));

import { collabRoomHub } from "../../../hosts/collab/room-hub.js";

function fakeWs(open = true): WebSocket {
  return {
    OPEN: 1,
    readyState: open ? 1 : 3,
    send: vi.fn(),
  } as unknown as WebSocket;
}

describe("collabRoomHub", () => {
  it("announces the online list on subscribe and unsubscribe, deduplicated per user", async () => {
    const a1 = fakeWs();
    const a2 = fakeWs();
    const b = fakeWs();
    collabRoomHub.subscribe("room-1", { ws: a1, userId: "a", username: "A" });
    collabRoomHub.subscribe("room-1", { ws: a2, userId: "a", username: "A" });
    collabRoomHub.subscribe("room-1", { ws: b, userId: "b", username: "B" });

    expect(await collabRoomHub.onlineUsers("room-1")).toEqual([
      { userId: "a", username: "A" },
      { userId: "b", username: "B" },
    ]);

    await vi.waitFor(() => expect(b.send).toHaveBeenCalled());
    const last = JSON.parse(
      (b.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string,
    );
    expect(last).toEqual({
      type: "collab_online",
      roomId: "room-1",
      users: [
        { userId: "a", username: "A" },
        { userId: "b", username: "B" },
      ],
    });

    collabRoomHub.unsubscribe(a1);
    expect(await collabRoomHub.onlineUsers("room-1")).toHaveLength(2);
    collabRoomHub.unsubscribe(a2);
    expect(await collabRoomHub.onlineUsers("room-1")).toEqual([
      { userId: "b", username: "B" },
    ]);
    collabRoomHub.unsubscribe(b);
    expect(await collabRoomHub.onlineUsers("room-1")).toEqual([]);
  });

  it("subscribing the same socket twice keeps one subscription", async () => {
    const ws = fakeWs();
    collabRoomHub.subscribe("room-2", { ws, userId: "a", username: "A" });
    collabRoomHub.subscribe("room-2", { ws, userId: "a", username: "A" });
    await vi.waitFor(() =>
      expect((ws.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1),
    );
    collabRoomHub.unsubscribe(ws);
  });

  it("broadcast skips closed sockets and rooms nobody watches", () => {
    const open = fakeWs();
    const closed = fakeWs(false);
    collabRoomHub.subscribe("room-3", { ws: open, userId: "a", username: "A" });
    collabRoomHub.subscribe("room-3", {
      ws: closed,
      userId: "b",
      username: "B",
    });
    (open.send as ReturnType<typeof vi.fn>).mockClear();
    (closed.send as ReturnType<typeof vi.fn>).mockClear();

    collabRoomHub.broadcast("room-3", { type: "collab_stage_changed" });
    collabRoomHub.broadcast("nobody", { type: "collab_stage_changed" });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closed.send).not.toHaveBeenCalled();
    collabRoomHub.unsubscribe(open);
    collabRoomHub.unsubscribe(closed);
  });

  it("fans out remote Redis events but keeps internal events server-side", () => {
    const ws = fakeWs();
    collabRoomHub.subscribe("room-4", { ws, userId: "a", username: "A" });
    (ws.send as ReturnType<typeof vi.fn>).mockClear();

    runtime.listener?.("room-4", { type: "collab_members_changed" });
    runtime.listener?.("room-4", { type: "collab_internal_stage_revoked" });

    expect(ws.send).toHaveBeenCalledTimes(1);
    collabRoomHub.unsubscribe(ws);
  });
});
