import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import ssh2Pkg from "ssh2";
import {
  generateEphemeralKeyPair,
  parseCertValidBefore,
  startVaultOidc,
  completeVaultOidc,
  signWithVault,
  type VaultProfileConfig,
} from "./vault-signer-core.js";

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

      // Both halves must be parseable by the same library that signs/connects.
      const priv = ssh2Utils.parseKey(pair.privateKey);
      expect(priv instanceof Error).toBe(false);
      const pub = ssh2Utils.parseKey(pair.publicKey);
      expect(pub instanceof Error).toBe(false);
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
      execFileSync("ssh-keygen", [
        "-t",
        "ed25519",
        "-f",
        `${dir}/ca`,
        "-N",
        "",
        "-q",
      ]);
      execFileSync("ssh-keygen", [
        "-t",
        "ed25519",
        "-f",
        `${dir}/user`,
        "-N",
        "",
        "-q",
      ]);
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
    if (!haveSshKeygen) {
      console.warn("ssh-keygen unavailable; skipping real-cert parse test");
      return;
    }
    const validBefore = parseCertValidBefore(cert);
    // -V +60m => valid_before is roughly signedAt + 3600 (start rounds to minute)
    expect(validBefore).toBeGreaterThan(signedAt + 3300);
    expect(validBefore).toBeLessThan(signedAt + 3900);
  });

  it("returns 0 for malformed input", () => {
    expect(parseCertValidBefore("")).toBe(0);
    expect(parseCertValidBefore("not-a-cert")).toBe(0);
    expect(parseCertValidBefore("ssh-ed25519 AAAAnotbase64!!")).toBe(0);
  });
});

describe("Vault HTTP flow (mocked fetch)", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(
    impl: (
      url: string,
      init: RequestInit,
    ) => { status?: number; body: unknown },
  ) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const { status = 200, body } = impl(url, init);
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(body),
        } as Response;
      }),
    );
    return calls;
  }

  it("startVaultOidc posts auth_url and extracts state", async () => {
    const calls = mockFetch(() => ({
      body: {
        data: {
          auth_url:
            "https://idp.example.com/authorize?client_id=x&state=ST-abc123&nonce=n",
        },
      },
    }));

    const result = await startVaultOidc(
      profile,
      "https://termix/vault/oidc/callback",
    );

    expect(result.state).toBe("ST-abc123");
    expect(result.clientNonce).toMatch(/^[0-9a-f]{40}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://vault.example.com:8200/v1/auth/oidc/oidc/auth_url",
    );
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Vault-Namespace"]).toBe("team-a");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      role: "developer",
      redirect_uri: "https://termix/vault/oidc/callback",
    });
    expect(body.client_nonce).toBe(result.clientNonce);
  });

  it("completeVaultOidc returns the client token", async () => {
    const calls = mockFetch(() => ({
      body: { auth: { client_token: "hvs.TESTTOKEN" } },
    }));

    const token = await completeVaultOidc(profile, {
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
    expect(calls[0].init.method).toBe("GET");
  });

  it("signWithVault posts the public key and returns signed_key", async () => {
    const calls = mockFetch(() => ({
      body: {
        data: { signed_key: "ssh-ed25519-cert-v01@openssh.com AAAAcert" },
      },
    }));

    const cert = await signWithVault(
      profile,
      "hvs.TESTTOKEN",
      "ssh-ed25519 AAAApub comment",
    );

    expect(cert).toBe("ssh-ed25519-cert-v01@openssh.com AAAAcert");
    expect(calls[0].url).toBe(
      "https://vault.example.com:8200/v1/ssh-client-signer/sign/my-role",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Vault-Token"]).toBe("hvs.TESTTOKEN");
    expect(headers["X-Vault-Namespace"]).toBe("team-a");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      public_key: "ssh-ed25519 AAAApub comment",
      cert_type: "user",
      valid_principals: "root,deploy",
    });
  });

  it("surfaces Vault error messages", async () => {
    mockFetch(() => ({
      status: 400,
      body: { errors: ["role not found", "permission denied"] },
    }));

    await expect(
      signWithVault(profile, "tok", "ssh-ed25519 AAAA"),
    ).rejects.toThrow(/role not found; permission denied/);
  });
});

// Live integration against a real Vault (e.g. `vault server -dev` in Docker).
// Runs only when VAULT_ADDR + VAULT_TOKEN are set and the SSH signer mount
// (VAULT_SSH_MOUNT/VAULT_SSH_ROLE) has been configured by the test harness.
describe("Vault live signing", () => {
  const addr = process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  const run = !!addr && !!token;

  it.skipIf(!run)("signs an ephemeral key against a real Vault", async () => {
    const profile: VaultProfileConfig = {
      id: 99,
      vaultAddr: addr!,
      sshMount: process.env.VAULT_SSH_MOUNT || "ssh-client-signer",
      sshRole: process.env.VAULT_SSH_ROLE || "my-role",
      validPrincipals: "root",
      keyType: "ssh-ed25519",
    };

    const pair = generateEphemeralKeyPair(profile.keyType);
    const before = Math.floor(Date.now() / 1000);
    const cert = await signWithVault(profile, token!, pair.publicKey);

    expect(cert).toMatch(/-cert-v01@openssh\.com /);
    // The signed cert must parse with the same library used to connect.
    const parsed = ssh2Utils.parseKey(cert);
    expect(parsed instanceof Error).toBe(false);

    const validBefore = parseCertValidBefore(cert);
    expect(validBefore).toBeGreaterThan(before);
  });
});
