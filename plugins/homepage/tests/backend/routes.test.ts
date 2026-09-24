import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer;

afterEach(async () => {
  await server.close();
});

describe("homepage item routes", () => {
  beforeEach(async () => {
    server = await startServer();
  });

  it("creates, lists, updates and deletes an item", async () => {
    const created = await server.request("POST", "/items", {
      body: { typeId: "clock", title: "My Clock", config: { format: "24h" } },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ typeId: "clock", title: "My Clock" });
    expect(created.body.syncId).toEqual(expect.any(String));

    const list = await server.request("GET", "/items");
    expect(list.body).toHaveLength(1);

    const updated = await server.request("PUT", `/items/${created.body.id}`, {
      body: { title: "Renamed" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Renamed");

    const deleted = await server.request("DELETE", `/items/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect((await server.request("GET", "/items")).body).toHaveLength(0);
  });

  it("rejects a missing typeId", async () => {
    const res = await server.request("POST", "/items", { body: {} });
    expect(res.status).toBe(400);
  });

  it("404s updating or deleting another user's item", async () => {
    const created = await server.request("POST", "/items", {
      body: { typeId: "clock" },
    });
    const res = await server.request("DELETE", `/items/${created.body.id}`, {
      user: "user-2",
    });
    expect(res.status).toBe(404);
  });
});

describe("homepage layout routes", () => {
  beforeEach(async () => {
    server = await startServer();
  });

  it("returns null before any layout is saved, then round-trips one", async () => {
    expect((await server.request("GET", "/layout")).body).toBeNull();

    const saved = await server.request("PUT", "/layout", {
      body: { entries: [], pan: { x: 0, y: 0 }, zoom: 1 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.layout).toEqual({
      entries: [],
      pan: { x: 0, y: 0 },
      zoom: 1,
    });

    const fetched = await server.request("GET", "/layout");
    expect(fetched.body.layout.zoom).toBe(1);
  });
});

describe("service link routes", () => {
  beforeEach(async () => {
    server = await startServer();
  });

  it("creates, lists, updates and deletes a service link", async () => {
    const created = await server.request("POST", "/service-links", {
      body: { label: "Grafana", url: "grafana.local" },
    });
    expect(created.status).toBe(201);
    // A bare host gets normalized to http://.
    expect(created.body.url).toBe("http://grafana.local");

    const list = await server.request("GET", "/service-links");
    expect(list.body).toHaveLength(1);

    const updated = await server.request(
      "PUT",
      `/service-links/${created.body.id}`,
      { body: { label: "Grafana Dashboard" } },
    );
    expect(updated.body.label).toBe("Grafana Dashboard");

    const deleted = await server.request(
      "DELETE",
      `/service-links/${created.body.id}`,
    );
    expect(deleted.status).toBe(200);
    expect((await server.request("GET", "/service-links")).body).toHaveLength(
      0,
    );
  });

  it("rejects an invalid url", async () => {
    const res = await server.request("POST", "/service-links", {
      body: { label: "Bad", url: "javascript:alert(1)" },
    });
    expect(res.status).toBe(400);
  });
});

describe("permission denial", () => {
  it("answers 403 for every route without homepage.use", async () => {
    server = await startServer({ permissions: [] });
    expect((await server.request("GET", "/items")).status).toBe(403);
    expect((await server.request("GET", "/layout")).status).toBe(403);
    expect((await server.request("GET", "/service-links")).status).toBe(403);
  });
});
