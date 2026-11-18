import { describe, expect, it } from "vitest";
import {
  CORE_RULES,
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

  it("lets a frame show and revoke only the user's own keys", () => {
    for (const [method, path] of [
      ["GET", "/users/sessions"],
      ["GET", "/users/api-keys/mine"],
      ["DELETE", "/users/api-keys/mine/abc_DEF-1"],
      ["POST", "/users/api-keys/mine/revoke-all"],
      ["GET", "/users/admin-holds"],
      ["GET", "/users/admin-holds/settings"],
    ]) {
      expect(checkCoreRequest("login-security", method, path).ok, path).toBe(
        true,
      );
    }
    for (const [method, path] of [
      ["GET", "/users/api-keys"],
      ["DELETE", "/users/api-keys/abc"],
      ["DELETE", "/users/sessions/abc"],
      ["POST", "/users/sessions/revoke-all"],
      ["POST", "/users/sessions/revoke-everyone"],
      ["POST", "/users/admin-holds/abc/cancel"],
      ["PUT", "/users/admin-holds/settings"],
    ]) {
      expect(
        checkCoreRequest("login-security", method, path).ok,
        `${method} ${path}`,
      ).toBe(false);
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
  it("reads waiting approvals but never decides one", () => {
    expect(checkCoreRequest("ops", "GET", "/operations/approvals").ok).toBe(
      true,
    );
    expect(
      checkCoreRequest("ops", "POST", "/operations/approvals/abc").ok,
    ).toBe(false);
  });

  it("allows the reads official plugins' views need", () => {
    for (const path of [
      "/users/auth/step-up/factors",
      "/ssh-auth/providers",
      "/plugins",
    ]) {
      expect([path, checkCoreRequest("x", "GET", path).ok]).toEqual([
        path,
        true,
      ]);
    }
    expect(
      checkCoreRequest("x", "POST", "/users/auth/step-up/totp/verify").ok,
    ).toBe(false);
    expect(checkCoreRequest("x", "POST", "/plugins/x/enable").ok).toBe(false);
  });

  it("builds every rule from the shared list", () => {
    expect(CORE_RULES.length).toBeGreaterThan(10);
    for (const rule of CORE_RULES) {
      expect(() => new RegExp(rule.path.split("{id}").join("x"))).not.toThrow();
      expect(rule.path.startsWith("^/")).toBe(true);
      expect(rule.path.endsWith("$") || rule.path.endsWith("(/|$)")).toBe(true);
      for (const method of rule.methods) {
        expect(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).toContain(
          method,
        );
      }
    }
  });

  it("only fills in the asking plugin's id, escaped", () => {
    expect(
      checkCoreRequest("a.b", "POST", "/operations/a.b.restart/run").ok,
    ).toBe(true);
    expect(
      checkCoreRequest("a.b", "POST", "/operations/aXb.restart/run").ok,
    ).toBe(false);
  });

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
  it("cuts the plugin list down to what any plugin may see", () => {
    const scoped = scopeCoreResponse("x", "/plugins", [
      {
        id: "alerts",
        name: "Alerts",
        version: "1.0.0",
        enabled: true,
        state: "active",
        contributes: { settings: {} },
        env: [{ name: "SMTP_PASSWORD" }],
        lastError: "boom",
        grantedCapabilities: ["network:outbound"],
        signedBy: "official",
      },
    ]);
    expect(scoped).toEqual([
      {
        id: "alerts",
        name: "Alerts",
        version: "1.0.0",
        enabled: true,
        state: "active",
        contributes: { settings: {} },
      },
    ]);
    expect(scopeCoreResponse("x", "/plugins", { not: "a list" })).toEqual([]);
  });

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
