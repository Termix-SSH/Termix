import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ssh2Pkg from "ssh2";
import type { PluginFetchInit } from "@termix/plugin-sdk/backend";
import {
  allowedHosts,
  completeVaultOidc,
  generateEphemeralKeyPair,
  parseCertValidBefore,
  signWithVault,
  startVaultOidc,
  type VaultProfileConfig,
} from "../../src/backend/vault-client.js";

const { utils: ssh2Utils } = ssh2Pkg;

describe("generateEphemeralKeyPair", () => {
  for (const keyType of [
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ssh-rsa",
  ] as const) {
    it(`generates a parseable ${keyType} keypair`, () => {
      const pair = generateEphemeralKeyPair(keyType);
      expect(pair.privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
      expect(pair.publicKey.split(/\s+/)[0]).toBe(keyType);
      expect(ssh2Utils.parseKey(pair.privateKey) instanceof Error).toBe(false);
      expect(ssh2Utils.parseKey(pair.publicKey) instanceof Error).toBe(false);
    });
  }

  it("defaults to ed25519 for unknown key types", () => {
    const pair = generateEphemeralKeyPair("nonsense");
    expect(pair.publicKey.startsWith("ssh-ed25519")).toBe(true);
  });
});

describe("parseCertValidBefore", () => {
  let cert = "";
  let signedAt = 0;
  let haveSshKeygen = true;

  beforeAll(() => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vault-cert-test-"));
    try {
      for (const name of ["ca", "user"]) {
        execFileSync("ssh-keygen", [
          "-t",
          "ed25519",
          "-f",
          `${dir}/${name}`,
          "-N",
          "",
          "-q",
        ]);
      }
      signedAt = Math.floor(Date.now() / 1000);
      execFileSync("ssh-keygen", [
        "-s",
        `${dir}/ca`,
        "-I",
        "test-id",
        "-n",
        "root",
        "-V",
        "+60m",
        `${dir}/user.pub`,
      ]);
      cert = readFileSync(`${dir}/user-cert.pub`, "utf8").trim();
    } catch {
      haveSshKeygen = false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads valid_before from a real ssh-keygen certificate", () => {
    if (!haveSshKeygen) return;
    const validBefore = parseCertValidBefore(cert);
    expect(validBefore).toBeGreaterThan(signedAt + 3300);
    expect(validBefore).toBeLessThan(signedAt + 3900);
  });

  it("returns 0 for malformed input", () => {
    expect(parseCertValidBefore("")).toBe(0);
    expect(parseCertValidBefore("not-a-cert")).toBe(0);
    expect(parseCertValidBefore("ssh-ed25519 AAAAnotbase64!!")).toBe(0);
  });
});

describe("the Vault HTTP flow", () => {
  const profile: VaultProfileConfig = {
    id: 1,
    vaultAddr: "https://vault.example.com:8200/",
    vaultNamespace: "team-a",
    oidcMount: "oidc",
    oidcRole: "developer",
    sshMount: "ssh-client-signer",
    sshRole: "my-role",
    validPrincipals: "root,deploy",
    keyType: "ssh-ed25519",
  };

  function fakeFetch(respond: () => { status?: number; body: unknown }) {
    const calls: Array<{ url: string; init?: PluginFetchInit }> = [];
    const fetch = async (url: string, init?: PluginFetchInit) => {
      calls.push({ url, init });
      const { status = 200, body } = respond();
      return new Response(JSON.stringify(body), { status });
    };
    return { fetch, calls };
  }

  it("allows only the profile's own Vault host past the private address guard", () => {
    expect(allowedHosts(profile)).toEqual(["vault.example.com"]);
    expect(allowedHosts({ ...profile, vaultAddr: "not a url" })).toEqual([]);
  });

  it("startVaultOidc posts auth_url and reads the state", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: {
        data: {
          auth_url:
            "https://idp.example.com/authorize?client_id=x&state=ST-abc123&nonce=n",
        },
      },
    }));

    const result = await startVaultOidc(
      fetch,
      profile,
      "https://termix/plugin-api/vault/oidc/callback",
    );

    expect(result.state).toBe("ST-abc123");
    expect(result.clientNonce).toMatch(/^[0-9a-f]{40}$/);
    expect(calls[0].url).toBe(
      "https://vault.example.com:8200/v1/auth/oidc/oidc/auth_url",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers?.["X-Vault-Namespace"]).toBe("team-a");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      role: "developer",
      redirect_uri: "https://termix/plugin-api/vault/oidc/callback",
      client_nonce: result.clientNonce,
    });
  });

  it("completeVaultOidc returns the client token", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: { auth: { client_token: "hvs.TESTTOKEN" } },
    }));

    const token = await completeVaultOidc(fetch, profile, {
      state: "ST-abc123",
      code: "auth-code",
      clientNonce: "nonce123",
    });

    expect(token).toBe("hvs.TESTTOKEN");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/auth/oidc/oidc/callback");
    expect(url.searchParams.get("state")).toBe("ST-abc123");
    expect(url.searchParams.get("code")).toBe("auth-code");
    expect(url.searchParams.get("client_nonce")).toBe("nonce123");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("signWithVault posts the public key and returns signed_key", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: {
        data: { signed_key: "ssh-ed25519-cert-v01@openssh.com AAAAcert" },
      },
    }));

    const cert = await signWithVault(
      fetch,
      profile,
      "hvs.TESTTOKEN",
      "ssh-ed25519 AAAApub comment",
    );

    expect(cert).toBe("ssh-ed25519-cert-v01@openssh.com AAAAcert");
    expect(calls[0].url).toBe(
      "https://vault.example.com:8200/v1/ssh-client-signer/sign/my-role",
    );
    expect(calls[0].init?.headers?.["X-Vault-Token"]).toBe("hvs.TESTTOKEN");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      public_key: "ssh-ed25519 AAAApub comment",
      cert_type: "user",
      valid_principals: "root,deploy",
    });
  });

  it("surfaces Vault error messages", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 400,
      body: { errors: ["role not found", "permission denied"] },
    }));
    await expect(
      signWithVault(fetch, profile, "tok", "ssh-ed25519 AAAA"),
    ).rejects.toThrow(/role not found; permission denied/);
  });

  it("reports an unreachable Vault", async () => {
    const fetch = async () => {
      throw new Error("refused");
    };
    await expect(
      startVaultOidc(fetch, profile, "https://termix/cb"),
    ).rejects.toThrow(/Failed to reach Vault/);
  });
});
