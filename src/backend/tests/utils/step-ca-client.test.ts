import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  buildAuthorizationUrl,
  certificateFingerprint,
  createPkce,
  decodeJwtClaims,
  generateSshKeyPair,
  normalizeCaUrl,
  normalizeFingerprint,
  parseSshCertificate,
} from "../../utils/step-ca-client.js";
import {
  generateCa,
  signUserCertificate,
} from "../../database/routes/ssh-certificate.js";

describe("step-ca client helpers", () => {
  it("normalizes the CA url and fingerprint the way step does", () => {
    expect(normalizeCaUrl(" https://ca.internal:9000/ ")).toBe(
      "https://ca.internal:9000",
    );
    expect(() => normalizeCaUrl("http://ca.internal")).toThrow(/https/);
    const fp = "AB:cd".repeat(16).replace(/:/g, "") + "";
    expect(normalizeFingerprint("AB:cd".repeat(16))).toBe(fp.toLowerCase());
    expect(() => normalizeFingerprint("abcd")).toThrow(/SHA-256/);
  });

  it("fingerprints a PEM certificate by the sha256 of its DER", () => {
    const der = crypto.randomBytes(64);
    const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64")}\n-----END CERTIFICATE-----\n`;
    expect(certificateFingerprint(pem)).toBe(
      crypto.createHash("sha256").update(der).digest("hex"),
    );
  });

  it("builds a PKCE authorization request", () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(
      crypto.createHash("sha256").update(verifier).digest("base64url"),
    );
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: "https://idp.example/auth?tenant=x",
        clientId: "cid",
        redirectUri: "https://termix.example/callback",
        state: "s",
        nonce: "n",
        codeChallenge: challenge,
      }),
    );
    expect(url.searchParams.get("tenant")).toBe("x");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  it("generates an ed25519 key whose public line a CA can certify, and reads the cert back", () => {
    const { publicKeyLine, privateKeyPem } = generateSshKeyPair();
    expect(publicKeyLine).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+$/);
    expect(privateKeyPem).toContain("BEGIN PRIVATE KEY");

    const ca = generateCa();
    const cert = signUserCertificate({
      userPublicKeyLine: publicKeyLine,
      caPrivateKeyPem: ca.privateKeyPem,
      caPublicKeyLine: ca.publicKeyLine,
      keyId: "alice@example",
      principals: ["alice", "ops"],
      validAfter: 1_700_000_000,
      validBefore: 1_700_057_600,
    });
    expect(cert).not.toBeNull();
    const info = parseSshCertificate(cert!);
    expect(info).toMatchObject({
      keyType: "ssh-ed25519-cert-v01@openssh.com",
      publicKeyLine,
      keyId: "alice@example",
      principals: ["alice", "ops"],
    });
    expect(info.validAfter.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(info.validBefore.getTime() - info.validAfter.getTime()).toBe(
      16 * 3600 * 1000,
    );
    expect(() => parseSshCertificate(publicKeyLine)).toThrow(/certificate/);
    expect(() =>
      parseSshCertificate("ssh-ed25519-cert-v01@openssh.com AAAA"),
    ).toThrow(/certificate/);
  });
});

describe("decodeJwtClaims", () => {
  it("reads the payload without verifying and tolerates junk", () => {
    const payload = Buffer.from(
      JSON.stringify({ email: "a@b.c", nonce: "n1" }),
    ).toString("base64url");
    expect(decodeJwtClaims(`x.${payload}.y`)).toEqual({
      email: "a@b.c",
      nonce: "n1",
    });
    expect(decodeJwtClaims("not-a-jwt")).toEqual({});
  });
});
