import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roomsByShare: new Map<string, { id: string }>(),
  members: new Set<string>(), // `${roomId}:${userId}`
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCollabRoomRepository: () => ({
    findByStageShareId: async (shareId: string) =>
      state.roomsByShare.get(shareId) ?? null,
    findMember: async (roomId: string, userId: string) =>
      state.members.has(`${roomId}:${userId}`) ? { roomId, userId } : null,
  }),
}));

const { canJoinRoomStageShare } =
  await import("../../../hosts/collab/room-share-access.js");

describe("canJoinRoomStageShare", () => {
  beforeEach(() => {
    state.roomsByShare.clear();
    state.members.clear();
  });

  it("admits members of the live room whose stage is this share", async () => {
    state.roomsByShare.set("share-1", { id: "room-1" });
    state.members.add("room-1:alice");
    await expect(canJoinRoomStageShare("share-1", "alice")).resolves.toBe(true);
  });

  it("rejects non-members and shares that are not a room stage", async () => {
    state.roomsByShare.set("share-1", { id: "room-1" });
    await expect(canJoinRoomStageShare("share-1", "mallory")).resolves.toBe(
      false,
    );
    await expect(canJoinRoomStageShare("share-9", "alice")).resolves.toBe(
      false,
    );
  });
});
