import { describe, expect, it } from "vitest";
import { keyScopeAllows, parseKeyScopes } from "../../operations/key-scopes.js";

const READ = ["operations:read"];
const RUN = ["operations:run"];

describe("keyScopeAllows", () => {
  it("leaves a key with no scopes alone", () => {
    expect(keyScopeAllows(null, "POST", "/users/ws-ticket/api-key")).toBe(true);
    expect(keyScopeAllows(null, "DELETE", "/host/1")).toBe(true);
  });

  it("keeps a scoped key off every other route", () => {
    for (const path of [
      "/users/ws-ticket/api-key",
      "/host/1",
      "/plugin-api/docker/1/containers",
      "/credentials",
    ]) {
      expect(keyScopeAllows(RUN, "GET", path)).toBe(false);
    }
  });

  it("lets a read key read and start runs the gate then checks", () => {
    expect(keyScopeAllows(READ, "GET", "/operations/catalog?lang=en")).toBe(
      true,
    );
    expect(keyScopeAllows(READ, "POST", "/operations/docker.list/run")).toBe(
      true,
    );
    expect(keyScopeAllows(READ, "POST", "/operations/approvals/abc")).toBe(
      false,
    );
    expect(keyScopeAllows(READ, "POST", "/operations/runs/abc/cancel")).toBe(
      false,
    );
  });

  it("reaches a plugin's MCP route only", () => {
    expect(keyScopeAllows(READ, "POST", "/plugin-api/some-plugin/mcp")).toBe(
      true,
    );
    expect(
      keyScopeAllows(READ, "POST", "/plugin-api/some-plugin/mcp-admin"),
    ).toBe(false);
  });

  it("does not match lookalike paths", () => {
    expect(keyScopeAllows(RUN, "GET", "/operationsx/catalog")).toBe(false);
  });

  it("lets a read only key make GET and HEAD requests and nothing else", () => {
    const ONLY_READ = ["read"];
    expect(keyScopeAllows(ONLY_READ, "GET", "/host/db/host")).toBe(true);
    expect(keyScopeAllows(ONLY_READ, "HEAD", "/credentials")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(keyScopeAllows(ONLY_READ, method, "/host/1")).toBe(false);
    }
    expect(keyScopeAllows(ONLY_READ, "POST", "/users/ws-ticket/api-key")).toBe(
      false,
    );
    expect(
      keyScopeAllows(ONLY_READ, "POST", "/operations/docker.list/run"),
    ).toBe(false);
    expect(keyScopeAllows(ONLY_READ, "POST", "/plugin-api/x/mcp")).toBe(false);
  });

  it("grants nothing with an empty list", () => {
    expect(keyScopeAllows([], "GET", "/operations/catalog")).toBe(false);
  });
});

describe("parseKeyScopes", () => {
  it("reads a list", () => {
    expect(parseKeyScopes('["operations:read"]')).toEqual(READ);
  });

  it("keeps old keys at full access", () => {
    expect(parseKeyScopes(null)).toBeNull();
  });

  it("fails closed on junk", () => {
    expect(parseKeyScopes("{nope")).toEqual([]);
    expect(parseKeyScopes('"x"')).toEqual([]);
  });
});
