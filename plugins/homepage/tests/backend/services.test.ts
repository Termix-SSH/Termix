import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});

afterEach(async () => {
  await server.close();
});

describe("homepage.items service", () => {
  it("lists the acting user's items", async () => {
    await server.request("POST", "/items", {
      body: { typeId: "clock", title: "My Clock" },
    });
    await server.request("POST", "/items", {
      body: { typeId: "notes" },
      user: "user-2",
    });

    server.mock.setActor("user-1");
    const service = server.mock.services.get("homepage.items") as
      | { list: () => Promise<Array<{ typeId: string; title: string | null }>> }
      | undefined;
    const items = await service!.list();
    expect(items).toEqual([
      { id: expect.any(Number), typeId: "clock", title: "My Clock" },
    ]);
  });

  it("returns an empty list with no acting user", async () => {
    server.mock.setActor(undefined);
    const service = server.mock.services.get("homepage.items") as
      { list: () => Promise<unknown[]> } | undefined;
    expect(await service!.list()).toEqual([]);
  });
});
