import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("homepage layout sync", () => {
  it("maps widget ids across devices and keeps canvas geometry", async () => {
    server = await startServer();
    const items = server.mock.syncEntities.find(
      (entry) => entry.type === "homepageItems",
    )!;
    const entity = server.mock.syncEntities.find(
      (entry) => entry.type === "homepageLayouts",
    )!;
    expect(entity.singleton).toBe(true);
    expect(entity.order).toBeGreaterThan(items.order!);
    const layout = {
      entries: [{ itemId: 7, x: 10, y: 20, w: 300, h: 200, zOrder: 2 }],
      pan: { x: 5, y: -3 },
      zoom: 0.75,
    };
    const exported = await entity.serialize!(
      { layout: JSON.stringify(layout) },
      async (type, id) =>
        type === "homepageItems" && id === 7 ? "widget-sync-id" : null,
    );
    expect(JSON.parse(exported.layout as string).entries[0].itemId).toBe(
      "widget-sync-id",
    );
    const imported = await entity.deserialize!(exported, async (type, id) =>
      type === "homepageItems" && id === "widget-sync-id" ? 91 : null,
    );
    expect(JSON.parse(imported.layout as string)).toEqual({
      ...layout,
      entries: [{ ...layout.entries[0], itemId: 91 }],
    });
  });

  it("drops unavailable widgets and refuses numeric wire ids", async () => {
    server = await startServer();
    const entity = server.mock.syncEntities.find(
      (entry) => entry.type === "homepageLayouts",
    )!;
    const resolveId = vi.fn(async () => null);
    const result = await entity.deserialize!(
      {
        layout: JSON.stringify({
          entries: [
            { itemId: "deleted", x: 1 },
            { itemId: 7, x: 2 },
          ],
          zoom: 1,
        }),
      },
      resolveId,
    );
    expect(JSON.parse(result.layout as string)).toEqual({
      entries: [],
      zoom: 1,
    });
    expect(resolveId).toHaveBeenCalledExactlyOnceWith(
      "homepageItems",
      "deleted",
    );
  });

  it("keeps an empty layout and rejects malformed JSON instead of copying local ids", async () => {
    server = await startServer();
    const entity = server.mock.syncEntities.find(
      (entry) => entry.type === "homepageLayouts",
    )!;
    const resolve = vi.fn(async () => null);
    await expect(entity.serialize!({ layout: "{}" }, resolve)).resolves.toEqual(
      { layout: "{}" },
    );
    await expect(
      entity.serialize!({ layout: "broken" }, resolve),
    ).rejects.toThrow();
  });
});
