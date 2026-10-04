import { describe, expect, it, vi } from "vitest";

const resolve = vi.fn(async (_userId: string, ref: string) => `real:${ref}`);
vi.mock("../../hosts/external-secrets.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveSecretReference: (userId: string, ref: string) => resolve(userId, ref),
}));

const { parseKeyForStorage, resolveKeyReferences } =
  await import("../../hosts/stored-ssh-key.js");

describe("parseKeyForStorage", () => {
  it("accepts a secret reference without parsing it", () => {
    expect(parseKeyForStorage(" op://v/i/private_key ")).toEqual({
      success: true,
      privateKey: "op://v/i/private_key",
      publicKey: "",
      keyType: "",
      reference: true,
    });
  });

  it("does not try to open a real key with a referenced passphrase", () => {
    const result = parseKeyForStorage("-----BEGIN...", "op://v/i/pass");
    expect(result).toMatchObject({ success: true, reference: true });
  });

  it("parses anything else as a key", () => {
    const result = parseKeyForStorage("not a key");
    expect(result.success).toBe(false);
    expect(result.reference).toBe(false);
  });
});

describe("resolveKeyReferences", () => {
  it("resolves only the values that are references", async () => {
    expect(await resolveKeyReferences("u1", "op://v/i/key", "plain")).toEqual({
      key: "real:op://v/i/key",
      passphrase: "plain",
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
