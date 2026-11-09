import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hostOverride: null as number | null,
  folderOverride: null as { folder: string; credentialId: number } | null,
  credentials: new Map<number, Record<string, unknown>>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: vi.fn(),
  createCurrentSharedHostAuthOverrideRepository: () => ({
    findCredentialId: async () => h.hostOverride,
  }),
  createCurrentSharedFolderAuthOverrideRepository: () => ({
    findClosest: async () => h.folderOverride,
  }),
}));
vi.mock("../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (id: number) => h.credentials.get(id) ?? null,
}));

import { resolveDeviceLogin } from "../../hosts/device-auth.js";

const copy = { id: 5, folder: "Team", sharedSource: '{"hostId":9}' };
const local = { id: 1, password: "device", localOnly: true };
const synced = { id: 2, password: "server", localOnly: false };

beforeEach(() => {
  vi.stubEnv("ELECTRON_EMBEDDED", "true");
  h.hostOverride = null;
  h.folderOverride = null;
  h.credentials = new Map([
    [1, local],
    [2, synced],
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDeviceLogin", () => {
  it("uses the host's own device login first", async () => {
    h.hostOverride = 1;
    h.folderOverride = { folder: "Team", credentialId: 2 };
    expect(await resolveDeviceLogin(copy, "u1", "rdp")).toBe(local);
  });

  it("falls back to the folder's device login", async () => {
    h.folderOverride = { folder: "Team", credentialId: 1 };
    expect(await resolveDeviceLogin(copy, "u1", "ssh")).toBe(local);
  });

  it("never treats a synced credential as a device login", async () => {
    h.hostOverride = 2;
    expect(await resolveDeviceLogin(copy, "u1", "ssh")).toBeNull();
  });

  it("only applies to shared copies", async () => {
    h.hostOverride = 1;
    expect(
      await resolveDeviceLogin({ id: 5, sharedSource: null }, "u1", "ssh"),
    ).toBeNull();
  });

  it("does nothing on a server", async () => {
    vi.stubEnv("ELECTRON_EMBEDDED", "false");
    h.hostOverride = 1;
    expect(await resolveDeviceLogin(copy, "u1", "ssh")).toBeNull();
  });
});
