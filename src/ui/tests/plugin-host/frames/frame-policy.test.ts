import { describe, expect, it } from "vitest";
import {
  checkCoreRequest,
  frameHeaders,
  scopeCoreResponse,
} from "@/plugin-host/frames/frame-policy";

describe("checkCoreRequest", () => {
  it("allows the reads the SDK hooks and UI kit make", () => {
    for (const [method, path] of [
      ["GET", "/users/me"],
      ["GET", "/rbac/permissions/me"],
      ["GET", "/host/db/host"],
      ["GET", "/host/db/host/4"],
      ["GET", "/credentials"],
      ["POST", "/dashboard/activity/log"],
      ["GET", "/operations/catalog?x=1"],
    ]) {
      expect(checkCoreRequest("docker", method, path).ok, path).toBe(true);
    }
  });

  it("allows only the asking plugin's own settings", () => {
    expect(
      checkCoreRequest("docker", "GET", "/plugins/docker/settings/user").ok,
    ).toBe(true);
    expect(
      checkCoreRequest("docker", "PUT", "/plugins/docker/settings/host/3").ok,
    ).toBe(true);
    expect(
      checkCoreRequest("docker", "GET", "/plugins/snippets/settings/user").ok,
    ).toBe(false);
    expect(
      checkCoreRequest("docker", "GET", "/plugins/docker/settings/host/x").ok,
    ).toBe(false);
  });

  it("refuses writes, other plugins' routes, logins and admin routes", () => {
    for (const [method, path] of [
      ["DELETE", "/host/db/host/4"],
      ["PUT", "/host/db/host/4"],
      ["GET", "/credentials/4"],
      ["POST", "/users/ws-ticket"],
      ["POST", "/users/api-keys"],
      ["GET", "/plugin-api/snippets/list"],
      ["POST", "/plugins/docker/frame-token"],
      ["POST", "/operations/snippets.run/run"],
      ["GET", "/users/me/../api-keys"],
      ["GET", "/users/%2e%2e/api-keys"],
      ["GET", "//evil.example/users/me"],
      ["GET", "users/me"],
    ]) {
      expect(
        checkCoreRequest("docker", method, path).ok,
        `${method} ${path}`,
      ).toBe(false);
    }
    expect(
      checkCoreRequest(
        "docker",
        "POST",
        "/operations/docker.start-container/run",
      ).ok,
    ).toBe(true);
  });
});

describe("frameHeaders", () => {
  it("drops headers the shell owns", () => {
    expect(
      frameHeaders({
        Authorization: "Bearer x",
        Cookie: "jwt=x",
        "X-Admin-Target-User": "u2",
        "X-Electron-App": "true",
        "X-Termix-Device-ID": "d",
        "Content-Type": "application/json",
        Accept: "application/json",
        Weird: 5 as never,
      }),
    ).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });
});

describe("scopeCoreResponse", () => {
  it("leaves only the asking plugin's settings on host records", () => {
    const hosts = [
      { id: 1, pluginSettings: { docker: { a: 1 }, vault: { secret: "s" } } },
      { id: 2 },
    ];
    expect(scopeCoreResponse("docker", "/host/db/host", hosts)).toEqual([
      { id: 1, pluginSettings: { docker: { a: 1 } } },
      { id: 2, pluginSettings: {} },
    ]);
    expect(scopeCoreResponse("docker", "/host/db/host/1", hosts[0])).toEqual({
      id: 1,
      pluginSettings: { docker: { a: 1 } },
    });
    expect(scopeCoreResponse("docker", "/users/me", { a: 1 })).toEqual({
      a: 1,
    });
  });
});
