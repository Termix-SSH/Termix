import { describe, expect, it } from "vitest";
import { collabRuntimeStore } from "../../../hosts/collab/runtime-store.js";

describe("collabRuntimeStore local fallback", () => {
  it("stores stage control and an ordered, deduplicated request queue", async () => {
    const roomId = `fallback-${crypto.randomUUID()}`;

    await collabRuntimeStore.setController(roomId, "alice");
    expect(await collabRuntimeStore.getController(roomId)).toBe("alice");

    await collabRuntimeStore.upsertRequest(roomId, {
      userId: "bob",
      username: "Bob",
      requestedAt: "2026-08-25T00:00:02.000Z",
    });
    await collabRuntimeStore.upsertRequest(roomId, {
      userId: "alice",
      username: "Alice",
      requestedAt: "2026-08-25T00:00:01.000Z",
    });
    await collabRuntimeStore.upsertRequest(roomId, {
      userId: "bob",
      username: "Bob",
      requestedAt: "2026-08-25T00:00:03.000Z",
    });

    expect(await collabRuntimeStore.listRequests(roomId)).toEqual([
      expect.objectContaining({ userId: "alice" }),
      expect.objectContaining({ userId: "bob" }),
    ]);
    await collabRuntimeStore.removeRequest(roomId, "alice");
    expect(await collabRuntimeStore.listRequests(roomId)).toHaveLength(1);

    await collabRuntimeStore.clearRequests(roomId);
    await collabRuntimeStore.setController(roomId, null);
    expect(await collabRuntimeStore.listRequests(roomId)).toEqual([]);
    expect(await collabRuntimeStore.getController(roomId)).toBeNull();
  });
});
