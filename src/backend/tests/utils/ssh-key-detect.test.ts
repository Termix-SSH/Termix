import { describe, expect, it } from "vitest";
import { parsePublicKey, parseSSHKey } from "../../utils/ssh-key-utils.js";

const b64 = (text: string) => Buffer.from(text, "binary").toString("base64");
const pem = (label: string, body: string) =>
  `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;

describe("private key type guess when the parser can't read the key", () => {
  it.each([
    [
      "ed25519 by name",
      pem("OPENSSH PRIVATE KEY", "ssh-ed25519 junk"),
      "ssh-ed25519",
    ],
    ["rsa by name", pem("OPENSSH PRIVATE KEY", "ssh-rsa junk"), "ssh-rsa"],
    [
      "p256 by name",
      pem("OPENSSH PRIVATE KEY", "ecdsa-sha2-nistp256"),
      "ecdsa-sha2-nistp256",
    ],
    [
      "p384 by name",
      pem("OPENSSH PRIVATE KEY", "ecdsa-sha2-nistp384"),
      "ecdsa-sha2-nistp384",
    ],
    [
      "p521 by name",
      pem("OPENSSH PRIVATE KEY", "ecdsa-sha2-nistp521"),
      "ecdsa-sha2-nistp521",
    ],
    ["rsa in body", pem("OPENSSH PRIVATE KEY", b64("xxssh-rsaxx")), "ssh-rsa"],
    [
      "ed25519 in body",
      pem("OPENSSH PRIVATE KEY", b64("ssh-ed25519")),
      "ssh-ed25519",
    ],
    [
      "p256 in body",
      pem("OPENSSH PRIVATE KEY", b64("ecdsa-sha2-nistp256")),
      "ecdsa-sha2-nistp256",
    ],
    [
      "p384 in body",
      pem("OPENSSH PRIVATE KEY", b64("ecdsa-sha2-nistp384")),
      "ecdsa-sha2-nistp384",
    ],
    [
      "p521 in body",
      pem("OPENSSH PRIVATE KEY", b64("ecdsa-sha2-nistp521")),
      "ecdsa-sha2-nistp521",
    ],
    [
      "openssh with nothing known",
      pem("OPENSSH PRIVATE KEY", b64("nothing")),
      "ssh-rsa",
    ],
    ["pkcs1 rsa", pem("RSA PRIVATE KEY", "AAAA"), "ssh-rsa"],
    ["dsa", pem("DSA PRIVATE KEY", "AAAA"), "ssh-dss"],
    ["sec1 ec", pem("EC PRIVATE KEY", "AAAA"), "ecdsa-sha2-nistp256"],
    [
      "pkcs8 rsa oid",
      pem("PRIVATE KEY", b64("1.2.840.113549.1.1.1")),
      "ssh-rsa",
    ],
    [
      "pkcs8 p256 oid",
      pem("PRIVATE KEY", b64("1.2.840.10045.2.1 1.2.840.10045.3.1.7")),
      "ecdsa-sha2-nistp256",
    ],
    [
      "pkcs8 ec oid",
      pem("PRIVATE KEY", b64("1.2.840.10045.2.1")),
      "ecdsa-sha2-nistp256",
    ],
    [
      "pkcs8 ed25519 oid",
      pem("PRIVATE KEY", b64("1.3.101.112")),
      "ssh-ed25519",
    ],
    ["short pkcs8", pem("PRIVATE KEY", "QUJD"), "ssh-ed25519"],
    ["long pkcs8", pem("PRIVATE KEY", "QUJD".repeat(450)), "ssh-rsa"],
    [
      "mid pkcs8",
      pem("PRIVATE KEY", "QUJD".repeat(250)),
      "ecdsa-sha2-nistp256",
    ],
  ])("%s", (_name, key, type) => {
    const info = parseSSHKey(key);
    expect(info.keyType).toBe(type);
    expect(info.success).toBe(true);
    expect(info.publicKey).toBe("");
  });

  it("says plainly when it can't tell what a key is", () => {
    const info = parseSSHKey("not a key at all");
    expect(info.success).toBe(false);
    expect(info.keyType).toBe("unknown");
    expect(info.error).toBeTruthy();
  });

  it("explains PuTTY keys", () => {
    const info = parseSSHKey(
      "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: x\nPublic-Lines: 1\nAAAA\nPrivate-Lines: 1\nAAAA\nPrivate-MAC: 00",
    );
    expect(info.success).toBe(false);
    expect(info.error).toMatch(/putty/i);
  });
});

describe("public key types", () => {
  it.each([
    [
      "ssh-ed25519-cert-v01@openssh.com AAAA",
      "ssh-ed25519-cert-v01@openssh.com",
    ],
    ["ssh-rsa-cert-v01@openssh.com AAAA", "ssh-rsa-cert-v01@openssh.com"],
    [
      "ecdsa-sha2-nistp256-cert-v01@openssh.com AAAA",
      "ecdsa-sha2-nistp256-cert-v01@openssh.com",
    ],
    [
      "ecdsa-sha2-nistp384-cert-v01@openssh.com AAAA",
      "ecdsa-sha2-nistp384-cert-v01@openssh.com",
    ],
    [
      "ecdsa-sha2-nistp521-cert-v01@openssh.com AAAA",
      "ecdsa-sha2-nistp521-cert-v01@openssh.com",
    ],
    [
      "sk-ssh-ed25519-cert-v01@openssh.com AAAA",
      "sk-ssh-ed25519-cert-v01@openssh.com",
    ],
    ["ssh-rsa AAAA", "ssh-rsa"],
    ["ssh-ed25519 AAAA", "ssh-ed25519"],
    ["ecdsa-sha2-nistp256 AAAA", "ecdsa-sha2-nistp256"],
    ["ecdsa-sha2-nistp384 AAAA", "ecdsa-sha2-nistp384"],
    ["ecdsa-sha2-nistp521 AAAA", "ecdsa-sha2-nistp521"],
    ["ssh-dss AAAA", "ssh-dss"],
    [pem("PUBLIC KEY", b64("1.2.840.113549.1.1.1")), "ssh-rsa"],
    [
      pem("PUBLIC KEY", b64("1.2.840.10045.2.1 1.2.840.10045.3.1.7")),
      "ecdsa-sha2-nistp256",
    ],
    [pem("PUBLIC KEY", b64("1.2.840.10045.2.1")), "ecdsa-sha2-nistp256"],
    [pem("PUBLIC KEY", b64("1.3.101.112")), "ssh-ed25519"],
    [pem("PUBLIC KEY", "QUJD"), "ssh-ed25519"],
    [pem("PUBLIC KEY", "QUJD".repeat(200)), "ssh-rsa"],
    [pem("PUBLIC KEY", "QUJD".repeat(110)), "ecdsa-sha2-nistp256"],
    [pem("RSA PUBLIC KEY", "AAAA"), "ssh-rsa"],
    ["comment AAAAB3NzaC1yc2E", "ssh-rsa"],
    ["comment AAAAC3NzaC1lZDI1NTE5", "ssh-ed25519"],
    ["x AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY", "ecdsa-sha2-nistp256"],
    ["x AAAAE2VjZHNhLXNoYTItbmlzdHAzODQ", "ecdsa-sha2-nistp384"],
    ["x AAAAE2VjZHNhLXNoYTItbmlzdHA1MjE", "ecdsa-sha2-nistp521"],
    ["x AAAAB3NzaC1kc3M", "ssh-dss"],
  ])("%s", (key, type) => {
    expect(parsePublicKey(key)).toMatchObject({ keyType: type, success: true });
  });

  it("does not guess a type for random text", () => {
    expect(parsePublicKey("hello world")).toMatchObject({
      keyType: "unknown",
      success: false,
    });
  });
});
