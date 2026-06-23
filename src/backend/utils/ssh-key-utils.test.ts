import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseSSHKey,
  parsePublicKey,
  preparePrivateKeyForSSH2,
  getFriendlyKeyTypeName,
  validateKeyPair,
} from "./ssh-key-utils.js";

// A real OpenSSH ed25519 keypair generated solely for these tests. It grants no
// access to anything and exists only so the ssh2 parsing path is exercised for
// real rather than only via the text-fallback heuristics.
const ED25519_PRIVATE = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBR/hJLX7eMinS4wJMfG2gWSttUiuSLvqDwVYT53x0qewAAAJihJo4koSaO
JAAAAAtzc2gtZWQyNTUxOQAAACBR/hJLX7eMinS4wJMfG2gWSttUiuSLvqDwVYT53x0qew
AAAEDLo85Twyg0v6V1zsJaeRaxq9KPQXkqGY0HiJtVMzCXEFH+Ektft4yKdLjAkx8baBZK
21SK5Iu+oPBVhPnfHSp7AAAAEHRlc3RAdGVybWl4LnRlc3QBAgMEBQ==
-----END OPENSSH PRIVATE KEY-----`;

const ED25519_PUBLIC =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFH+Ektft4yKdLjAkx8baBZK21SK5Iu+oPBVhPnfHSp7 test@termix.test";

const PPK_RSA_PRIVATE = readFileSync(
  "node_modules/ssh2/test/fixtures/keyParser/ppk_rsa",
  "utf8",
);

describe("parsePublicKey", () => {
  it("detects ssh-ed25519 public keys", () => {
    const info = parsePublicKey(ED25519_PUBLIC);
    expect(info.keyType).toBe("ssh-ed25519");
    expect(info.success).toBe(true);
  });

  it("detects ssh-rsa public keys", () => {
    const info = parsePublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABFakeData");
    expect(info.keyType).toBe("ssh-rsa");
    expect(info.success).toBe(true);
  });

  it("detects ecdsa public keys", () => {
    const info = parsePublicKey(
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYData",
    );
    expect(info.keyType).toBe("ecdsa-sha2-nistp256");
  });

  it("detects OpenSSH certificate types before plain types", () => {
    const info = parsePublicKey(
      "ssh-ed25519-cert-v01@openssh.com AAAAData comment",
    );
    expect(info.keyType).toBe("ssh-ed25519-cert-v01@openssh.com");
  });

  it("returns unknown for unrecognized content", () => {
    const info = parsePublicKey("not-a-key");
    expect(info.keyType).toBe("unknown");
    expect(info.success).toBe(false);
  });
});

describe("parseSSHKey", () => {
  it("parses a valid ed25519 private key and derives its type", () => {
    const info = parseSSHKey(ED25519_PRIVATE);
    expect(info.success).toBe(true);
    expect(info.keyType).toContain("ed25519");
    // ssh2 successfully derives the public key for a real OpenSSH key.
    expect(info.publicKey).toContain("ssh-ed25519");
  });

  it("reports failure for garbage input", () => {
    const info = parseSSHKey("definitely not a key");
    expect(info.success).toBe(false);
    expect(info.keyType).toBe("unknown");
  });

  it("accepts PuTTY PPK v2 private keys supported by ssh2", () => {
    const info = parseSSHKey(PPK_RSA_PRIVATE);
    expect(info.success).toBe(true);
    expect(info.keyType).toBe("ssh-rsa");
    expect(info.publicKey).toContain("ssh-rsa");
  });

  it("prepares PuTTY PPK v2 private keys for ssh2 connections", () => {
    const prepared = preparePrivateKeyForSSH2(PPK_RSA_PRIVATE);
    expect(prepared.toString("utf8")).toContain("PuTTY-User-Key-File-2");
  });

  it("reports unsupported PuTTY PPK versions clearly", () => {
    const info = parseSSHKey(
      "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n",
    );
    expect(info.success).toBe(false);
    expect(info.error).toMatch(/Unsupported PuTTY PPK v3/);
  });
});

describe("getFriendlyKeyTypeName", () => {
  it("maps known key types to friendly names", () => {
    expect(getFriendlyKeyTypeName("ssh-rsa")).toBe("RSA");
    expect(getFriendlyKeyTypeName("ssh-ed25519")).toBe("Ed25519");
    expect(getFriendlyKeyTypeName("ecdsa-sha2-nistp256")).toBe("ECDSA P-256");
    expect(getFriendlyKeyTypeName("ssh-dss")).toBe("DSA");
  });

  it("passes unknown types through unchanged", () => {
    expect(getFriendlyKeyTypeName("some-future-type")).toBe("some-future-type");
  });
});

describe("validateKeyPair", () => {
  it("validates a genuinely matching ed25519 key pair", () => {
    const result = validateKeyPair(ED25519_PRIVATE, ED25519_PUBLIC);
    expect(result.isValid).toBe(true);
    expect(result.privateKeyType).toContain("ed25519");
    expect(result.publicKeyType).toBe("ssh-ed25519");
  });

  it("fails when private and public key types mismatch", () => {
    const result = validateKeyPair(
      ED25519_PRIVATE,
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABFakeData",
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/mismatch|match/i);
  });

  it("fails when the public key is invalid", () => {
    const result = validateKeyPair(ED25519_PRIVATE, "garbage");
    expect(result.isValid).toBe(false);
  });

  it("fails when the private key is invalid", () => {
    const result = validateKeyPair(
      "garbage",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAData",
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/private key/i);
  });
});
