import { afterEach, describe, expect, it } from "vitest";
import { manifest, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("share target routes", () => {
  it("lists users and roles to share with", async () => {
    server = await startServer({
      shareableUsers: [{ id: "user-2", username: "bob" }],
      shareableRoles: [{ id: 3, name: "ops", displayName: "Ops" }],
    });
    const users = await server.request("GET", "/share-targets/users");
    expect(users.status).toBe(200);
    expect(users.body).toEqual({ users: [{ id: "user-2", username: "bob" }] });

    const roles = await server.request("GET", "/share-targets/roles");
    expect(roles.status).toBe(200);
    expect(roles.body).toEqual({
      roles: [{ id: 3, name: "ops", displayName: "Ops" }],
    });
  });

  it("needs the share permission", async () => {
    server = await startServer({ permissions: ["snippets.view"] });
    expect((await server.request("GET", "/share-targets/users")).status).toBe(
      403,
    );
  });

  it("fails without the hosts:write capability", async () => {
    server = await startServer({
      capabilities: manifest.capabilities.filter((c) => c !== "hosts:write"),
    });
    expect((await server.request("GET", "/share-targets/roles")).status).toBe(
      500,
    );
  });
});
