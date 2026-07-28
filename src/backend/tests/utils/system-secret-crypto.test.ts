import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "crypto";

const systemKey = crypto.randomBytes(32);
const getEncryptionKey = vi.hoisted(() => vi.fn());

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({ getEncryptionKey }) },
}));

const {
  decryptSsoConfigSecrets,
  decryptSystemSecret,
  encryptSsoConfigSecrets,
  encryptSystemSecret,
  isSystemEncrypted,
  SSO_SECRET_FIELDS,
} = await import("../../utils/system-secret-crypto.js");

beforeEach(() => {
  getEncryptionKey.mockReset();
  getEncryptionKey.mockResolvedValue(systemKey);
});

describe("system secret encryption", () => {
  it("round-trips a secret", async () => {
    const sealed = await encryptSystemSecret("s3cr3t-client-secret");

    expect(sealed).not.toContain("s3cr3t");
    expect(isSystemEncrypted(sealed)).toBe(true);
    await expect(decryptSystemSecret(sealed)).resolves.toBe(
      "s3cr3t-client-secret",
    );
  });

  it("produces a different ciphertext each time", async () => {
    const a = await encryptSystemSecret("same");
    const b = await encryptSystemSecret("same");

    // Random IV per call, so identical secrets are not identifiable.
    expect(a).not.toBe(b);
    await expect(decryptSystemSecret(a)).resolves.toBe("same");
    await expect(decryptSystemSecret(b)).resolves.toBe("same");
  });

  it("does not double-encrypt an already sealed value", async () => {
    const once = await encryptSystemSecret("value");
    const twice = await encryptSystemSecret(once);

    expect(twice).toBe(once);
  });

  it("leaves empty values alone", async () => {
    await expect(encryptSystemSecret("")).resolves.toBe("");
    await expect(decryptSystemSecret("")).resolves.toBe("");
  });

  it("detects tampering", async () => {
    const sealed = await encryptSystemSecret("value");
    const parts = sealed.replace("sysenc:v1:", "").split(":");
    const flipped = Buffer.from(parts[2], "base64");
    flipped[0] ^= 0xff;
    const tampered = `sysenc:v1:${parts[0]}:${parts[1]}:${flipped.toString("base64")}`;

    // GCM auth tag must reject a modified payload rather than return garbage.
    await expect(decryptSystemSecret(tampered)).rejects.toThrow();
  });

  it("rejects a malformed sealed value", async () => {
    await expect(
      decryptSystemSecret("sysenc:v1:only-one-part"),
    ).rejects.toThrow(/Malformed/);
  });
});

describe("legacy compatibility", () => {
  it("decodes values written by the old base64 scheme", async () => {
    const legacy = `encoded:${Buffer.from("old-secret").toString("base64")}`;

    // Must keep working: an existing install cannot be locked out of SSO login
    // just because the storage format changed.
    await expect(decryptSystemSecret(legacy)).resolves.toBe("old-secret");
  });

  it("decodes the mislabelled 'encrypted:' variant too", async () => {
    const legacy = `encrypted:${Buffer.from("old-secret").toString("base64")}`;

    await expect(decryptSystemSecret(legacy)).resolves.toBe("old-secret");
  });

  it("passes through a value that was never encoded", async () => {
    await expect(decryptSystemSecret("plain-secret")).resolves.toBe(
      "plain-secret",
    );
  });

  it("upgrades a legacy value on the next write", async () => {
    const legacy = `encoded:${Buffer.from("old-secret").toString("base64")}`;
    const plaintext = await decryptSystemSecret(legacy);
    const sealed = await encryptSystemSecret(plaintext);

    expect(isSystemEncrypted(sealed)).toBe(true);
    await expect(decryptSystemSecret(sealed)).resolves.toBe("old-secret");
  });
});

describe("SSO provider config", () => {
  it("seals only the secret fields", async () => {
    const sealed = await encryptSsoConfigSecrets({
      client_id: "termix",
      client_secret: "shhh",
      bindPassword: "ldap-pw",
      issuer_url: "https://idp.example",
    });

    expect(sealed.client_id).toBe("termix");
    expect(sealed.issuer_url).toBe("https://idp.example");
    expect(isSystemEncrypted(sealed.client_secret as string)).toBe(true);
    expect(isSystemEncrypted(sealed.bindPassword as string)).toBe(true);
  });

  it("round-trips a whole config", async () => {
    const original = {
      client_id: "termix",
      client_secret: "shhh",
      bindPassword: "ldap-pw",
    };

    const restored = await decryptSsoConfigSecrets(
      await encryptSsoConfigSecrets(original),
    );

    expect(restored).toEqual(original);
  });

  it("covers both secret fields", () => {
    expect([...SSO_SECRET_FIELDS]).toEqual(["client_secret", "bindPassword"]);
  });

  it("leaves a config without secrets untouched", async () => {
    const config = { client_id: "termix", scopes: "openid" };

    await expect(encryptSsoConfigSecrets(config)).resolves.toEqual(config);
    await expect(decryptSsoConfigSecrets(config)).resolves.toEqual(config);
  });

  it("does not let one unreadable secret take down the provider", async () => {
    const restored = await decryptSsoConfigSecrets({
      client_id: "termix",
      client_secret: "sysenc:v1:bad",
    });

    // The rest of the config survives; login fails later with a clearer error.
    expect(restored.client_id).toBe("termix");
    expect(restored.client_secret).toBe("sysenc:v1:bad");
  });
});
