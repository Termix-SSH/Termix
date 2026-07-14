import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQuickConnectHost,
  quickConnectHostToPayload,
} from "./quick-connect-host";

describe("quick connect host", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves password authentication when saving the connection", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const host = createQuickConnectHost({
      ip: "server.example.com",
      port: 2222,
      username: "root",
      authType: "password",
      password: "secret",
    });

    expect(host.id).toBe("quick-connect-1234");
    expect(quickConnectHostToPayload(host)).toMatchObject({
      name: "root@server.example.com",
      ip: "server.example.com",
      port: 2222,
      username: "root",
      authType: "password",
      password: "secret",
      connectionType: "ssh",
    });
  });

  it("keeps only the selected credential authentication data", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.2",
      port: 22,
      username: "deploy",
      authType: "credential",
      credentialId: "42",
      password: "ignored",
      key: "ignored",
    });
    const payload = quickConnectHostToPayload(host);

    expect(payload.credentialId).toBe(42);
    expect(payload.password).toBeUndefined();
    expect(payload.key).toBeUndefined();
  });
});
