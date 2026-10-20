import { describe, expect, it } from "vitest";
import {
  detectSshKeyType,
  generateSshKeyPair,
  publicKeyFromPrivate,
  validateSshKeyPair,
} from "../../../../packages/plugin-sdk/src/ssh-keys.js";

describe("plugin SDK ssh-keys", () => {
  it("generates a usable ed25519 pair", () => {
    const pair = generateSshKeyPair("ssh-ed25519", { comment: "test" });
    expect(pair.publicKey).toMatch(/^ssh-ed25519 /);
    expect(detectSshKeyType(pair.privateKey)).toBe("ssh-ed25519");
    expect(detectSshKeyType(pair.publicKey)).toBe("ssh-ed25519");
    expect(validateSshKeyPair(pair.privateKey, pair.publicKey)).toEqual({
      isValid: true,
    });
  });

  it("derives the public key and ignores the comment when matching", () => {
    const pair = generateSshKeyPair("ecdsa-sha2-nistp256");
    const derived = publicKeyFromPrivate(pair.privateKey);
    expect(derived).toMatch(/^ecdsa-sha2-nistp256 /);
    expect(
      validateSshKeyPair(pair.privateKey, `${derived} someone@host`).isValid,
    ).toBe(true);
  });

  it("generates RSA with a minimum size", () => {
    expect(() => generateSshKeyPair("ssh-rsa", { bits: 512 })).toThrow(/2048/);
    const pair = generateSshKeyPair("ssh-rsa", { bits: 2048 });
    expect(detectSshKeyType(pair.privateKey)).toBe("ssh-rsa");
  });

  it("works with a passphrase and fails without it", () => {
    const pair = generateSshKeyPair("ssh-ed25519", { passphrase: "secret" });
    expect(publicKeyFromPrivate(pair.privateKey)).toBeNull();
    expect(publicKeyFromPrivate(pair.privateKey, "secret")).toBe(
      pair.publicKey.split(" ").slice(0, 2).join(" "),
    );
  });

  it("flags a pair that does not belong together", () => {
    const a = generateSshKeyPair("ssh-ed25519");
    const b = generateSshKeyPair("ssh-ed25519");
    const result = validateSshKeyPair(a.privateKey, b.publicKey);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/match/);
  });

  it("reports garbage as unreadable", () => {
    expect(detectSshKeyType("not a key")).toBeNull();
    expect(publicKeyFromPrivate("not a key")).toBeNull();
    expect(validateSshKeyPair("x", "y").isValid).toBe(false);
  });

  it("rejects an unknown key type", () => {
    expect(() => generateSshKeyPair("ssh-dss" as never)).toThrow(/Unsupported/);
  });
});
