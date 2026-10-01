import { describe, expect, it, vi } from "vitest";
import {
  parseSecretReference,
  resolveConnectReference,
  testConnectSource,
} from "../../src/backend/onepassword-connect.js";
import type { PluginFetch } from "@termix/plugin-sdk/backend";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("1Password secret references", () => {
  it("parses op://vault/item/field, ignoring a query suffix", () => {
    expect(parseSecretReference("op://Infra/prod-db/password")).toEqual({
      vault: "Infra",
      item: "prod-db",
      field: "password",
    });
    expect(
      parseSecretReference(
        "op://Infra/deploy key/private key?ssh-format=openssh",
      ),
    ).toEqual({ vault: "Infra", item: "deploy key", field: "private key" });
    expect(parseSecretReference("op://Infra/only-two")).toBeNull();
    expect(parseSecretReference("https://x")).toBeNull();
  });
});

describe("testConnectSource", () => {
  it("returns the vault count when the token is valid", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { id: "v1", name: "Infra" },
        { id: "v2", name: "Dev" },
      ]),
    ) as unknown as PluginFetch;

    const count = await testConnectSource(fetch, {
      baseUrl: "https://connect.internal",
      token: "tok",
      allowedPrivateHosts: ["connect.internal"],
    });
    expect(count).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      "https://connect.internal/v1/vaults",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok" },
        allowPrivateHosts: ["connect.internal"],
      }),
    );
  });

  it("throws when the server answers with a non-2xx status", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([], false, 401),
      ) as unknown as PluginFetch;

    await expect(
      testConnectSource(fetch, {
        baseUrl: "https://connect.internal",
        token: "bad",
        allowedPrivateHosts: [],
      }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe("resolveConnectReference", () => {
  it("resolves a field by label across vault, item and field lookups", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "vid", name: "Infra" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "iid", title: "prod-db" }]))
      .mockResolvedValueOnce(
        jsonResponse({
          fields: [{ id: "f1", label: "password", value: "s3cret" }],
        }),
      ) as unknown as PluginFetch;

    const value = await resolveConnectReference(
      fetch,
      {
        baseUrl: "https://connect.internal",
        token: "tok",
        allowedPrivateHosts: [],
      },
      { vault: "Infra", item: "prod-db", field: "password" },
    );
    expect(value).toBe("s3cret");
  });

  it("fails clearly when the vault is not found", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([])) as unknown as PluginFetch;

    await expect(
      resolveConnectReference(
        fetch,
        {
          baseUrl: "https://connect.internal",
          token: "tok",
          allowedPrivateHosts: [],
        },
        { vault: "Missing", item: "x", field: "y" },
      ),
    ).rejects.toThrow(/vault "Missing" not found/);
  });
});
