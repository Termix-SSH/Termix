import { describe, it, expect } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  generateCa,
  signUserCertificate,
  ed25519RawFromLine,
} from "./ssh-certificate.js";

function publicKeyObjectFromLine(line: string) {
  const raw = ed25519RawFromLine(line);
  if (!raw) throw new Error("not ed25519");
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

// Split a cert blob into the signed body and the raw 64-byte ed25519 signature.
function splitCert(certLine: string): { body: Buffer; rawSig: Buffer } {
  const blob = Buffer.from(certLine.split(/\s+/)[1], "base64");
  // trailing signature string = str( str("ssh-ed25519") + str(64-byte sig) )
  const sigBlobLen = 4 + "ssh-ed25519".length + 4 + 64; // 83
  const body = blob.subarray(0, blob.length - (4 + sigBlobLen));
  const rawSig = blob.subarray(blob.length - 64);
  return { body, rawSig };
}

describe("generateCa", () => {
  it("produces a valid ed25519 public line and PKCS8 private key", () => {
    const ca = generateCa();
    expect(ca.publicKeyLine.startsWith("ssh-ed25519 ")).toBe(true);
    expect(ed25519RawFromLine(ca.publicKeyLine)?.length).toBe(32);
    expect(ca.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    // The PEM must load as a usable signing key.
    expect(() =>
      crypto.createPrivateKey({
        key: ca.privateKeyPem,
        format: "pem",
        type: "pkcs8",
      }),
    ).not.toThrow();
  });
});

describe("signUserCertificate", () => {
  it("returns null for non-ed25519 user keys", () => {
    const ca = generateCa();
    const cert = signUserCertificate({
      userPublicKeyLine: "ssh-rsa AAAAB3Nz",
      caPrivateKeyPem: ca.privateKeyPem,
      caPublicKeyLine: ca.publicKeyLine,
      keyId: "x",
      principals: [],
      validAfter: 0,
      validBefore: 1,
    });
    expect(cert).toBeNull();
  });

  it("produces a cert whose signature verifies against the CA key", () => {
    const ca = generateCa();
    const user = generateCa(); // reuse: a valid ed25519 public line
    const cert = signUserCertificate({
      userPublicKeyLine: user.publicKeyLine,
      caPrivateKeyPem: ca.privateKeyPem,
      caPublicKeyLine: ca.publicKeyLine,
      keyId: "termix:@alice",
      principals: ["root", "ubuntu"],
      validAfter: 1000,
      validBefore: 2000,
    });
    expect(cert).not.toBeNull();
    expect(cert!.startsWith("ssh-ed25519-cert-v01@openssh.com ")).toBe(true);

    const { body, rawSig } = splitCert(cert!);
    const caPub = publicKeyObjectFromLine(ca.publicKeyLine);
    expect(crypto.verify(null, body, caPub, rawSig)).toBe(true);

    // A different CA must NOT verify.
    const otherPub = publicKeyObjectFromLine(generateCa().publicKeyLine);
    expect(crypto.verify(null, body, otherPub, rawSig)).toBe(false);
  });

  it("is accepted and correctly parsed by ssh-keygen -L", () => {
    let sshKeygen: string;
    try {
      sshKeygen = execFileSync("ssh-keygen", ["--help"], { encoding: "utf8" });
      void sshKeygen;
    } catch (e) {
      // ssh-keygen prints usage to stderr and exits non-zero for --help; that's
      // fine — it means the binary exists. Only skip if it's truly missing.
      if ((e as { code?: string }).code === "ENOENT") return;
    }

    const ca = generateCa();
    const user = generateCa();
    const now = Math.floor(Date.now() / 1000);
    const cert = signUserCertificate({
      userPublicKeyLine: user.publicKeyLine,
      caPrivateKeyPem: ca.privateKeyPem,
      caPublicKeyLine: ca.publicKeyLine,
      keyId: "termix-test-id",
      principals: ["deploy"],
      validAfter: now,
      validBefore: now + 3600,
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-cert-"));
    const file = path.join(dir, "id-cert.pub");
    try {
      fs.writeFileSync(file, cert + "\n");
      const out = execFileSync("ssh-keygen", ["-L", "-f", file], {
        encoding: "utf8",
      });
      expect(out).toContain("user certificate");
      expect(out).toContain('Key ID: "termix-test-id"');
      expect(out).toContain("deploy");
      expect(out).toMatch(/permit-pty/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
