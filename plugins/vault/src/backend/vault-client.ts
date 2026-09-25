import crypto from "node:crypto";
import ssh2Pkg from "ssh2";
import type { PluginFetch } from "@termix/plugin-sdk/backend";

const { utils: ssh2Utils } = ssh2Pkg;

/**
 * Vault's HTTP API for SSH signing: an OIDC login for a short-lived Vault
 * token, then the SSH secrets engine signs an ephemeral public key. No Vault
 * token or long-lived key is ever stored.
 */

export interface VaultProfileConfig {
  id: number;
  vaultAddr: string;
  vaultNamespace?: string | null;
  oidcMount?: string | null;
  oidcRole?: string | null;
  sshMount?: string | null;
  sshRole: string;
  validPrincipals?: string | null;
  keyType?: string | null;
}

export interface EphemeralKeyPair {
  privateKey: string;
  publicKey: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type VaultJson = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export function normalizeAddr(addr: string): string {
  return addr.trim().replace(/\/+$/, "");
}

export function trimMount(
  mount: string | null | undefined,
  fallback: string,
): string {
  return (mount?.trim() || fallback).replace(/^\/+|\/+$/g, "");
}

function vaultHeaders(profile: VaultProfileConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (profile.vaultNamespace?.trim()) {
    headers["X-Vault-Namespace"] = profile.vaultNamespace.trim();
  }
  return headers;
}

/**
 * The profile's own Vault server may be private: someone configured it by
 * name, which 2.8 allowed too. Nothing else private is reachable.
 */
export function allowedHosts(profile: VaultProfileConfig): string[] {
  try {
    return [new URL(normalizeAddr(profile.vaultAddr)).hostname];
  } catch {
    return [];
  }
}

async function vaultRequest(
  fetch: PluginFetch,
  profile: VaultProfileConfig,
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<VaultJson> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      allowPrivateHosts: allowedHosts(profile),
    });
  } catch (e) {
    throw new Error(
      `Failed to reach Vault at ${url}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const text = await response.text();
  let json: VaultJson;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
  }

  if (!response.ok) {
    const errs =
      json && Array.isArray(json.errors) && json.errors.length
        ? json.errors.join("; ")
        : text || `HTTP ${response.status}`;
    throw new Error(`Vault request failed (${response.status}): ${errs}`);
  }
  return json;
}

/** An ephemeral SSH keypair in OpenSSH format. */
export function generateEphemeralKeyPair(
  keyType?: string | null,
): EphemeralKeyPair {
  let type: "ed25519" | "rsa" | "ecdsa" = "ed25519";
  const options: { bits?: number } = {};
  switch ((keyType || "ssh-ed25519").trim()) {
    case "ssh-rsa":
      type = "rsa";
      options.bits = 4096;
      break;
    case "ecdsa-sha2-nistp256":
      type = "ecdsa";
      options.bits = 256;
      break;
    default:
      type = "ed25519";
  }
  const pair = ssh2Utils.generateKeyPairSync(type as never, options as never);
  return { privateKey: pair.private, publicKey: pair.public };
}

/**
 * Starts a Vault OIDC login. `redirectUri` must be allowed by the Vault
 * role's allowed_redirect_uris and by the identity provider.
 */
export async function startVaultOidc(
  fetch: PluginFetch,
  profile: VaultProfileConfig,
  redirectUri: string,
): Promise<{ authUrl: string; state: string; clientNonce: string }> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.oidcMount, "oidc");
  const clientNonce = crypto.randomBytes(20).toString("hex");

  const json = await vaultRequest(
    fetch,
    profile,
    `${addr}/v1/auth/${mount}/oidc/auth_url`,
    "POST",
    vaultHeaders(profile),
    {
      role: profile.oidcRole?.trim() || "",
      redirect_uri: redirectUri,
      client_nonce: clientNonce,
    },
  );

  const authUrl: string | undefined = json?.data?.auth_url;
  if (!authUrl) {
    throw new Error("Vault did not return an OIDC auth_url");
  }

  // Vault puts its own state in the auth_url; the callback is matched on it.
  let state = "";
  try {
    state = new URL(authUrl).searchParams.get("state") || "";
  } catch {
    const m = authUrl.match(/[?&]state=([^&]+)/);
    state = m ? decodeURIComponent(m[1]) : "";
  }
  if (!state) {
    throw new Error("Could not determine OIDC state from Vault auth_url");
  }

  return { authUrl, state, clientNonce };
}

/** Completes the OIDC callback and returns a short-lived Vault token. */
export async function completeVaultOidc(
  fetch: PluginFetch,
  profile: VaultProfileConfig,
  params: { state: string; code: string; clientNonce: string },
): Promise<string> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.oidcMount, "oidc");

  const url = new URL(`${addr}/v1/auth/${mount}/oidc/callback`);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code", params.code);
  url.searchParams.set("client_nonce", params.clientNonce);

  const json = await vaultRequest(
    fetch,
    profile,
    url.toString(),
    "GET",
    vaultHeaders(profile),
  );
  const token: string | undefined = json?.auth?.client_token;
  if (!token) {
    throw new Error("Vault OIDC callback did not return a client token");
  }
  return token;
}

/** Signs an SSH public key with Vault, returning the OpenSSH certificate line. */
export async function signWithVault(
  fetch: PluginFetch,
  profile: VaultProfileConfig,
  vaultToken: string,
  publicKey: string,
): Promise<string> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.sshMount, "ssh-client-signer");

  const body: Record<string, unknown> = {
    public_key: publicKey.trim(),
    cert_type: "user",
  };
  if (profile.validPrincipals?.trim()) {
    body.valid_principals = profile.validPrincipals.trim();
  }

  const json = await vaultRequest(
    fetch,
    profile,
    `${addr}/v1/${mount}/sign/${encodeURIComponent(profile.sshRole.trim())}`,
    "POST",
    { ...vaultHeaders(profile), "X-Vault-Token": vaultToken },
    body,
  );
  const signedKey: string | undefined = json?.data?.signed_key;
  if (!signedKey) {
    throw new Error("Vault sign response did not include a signed_key");
  }
  return signedKey.trim();
}

/**
 * The "valid before" Unix timestamp of an OpenSSH certificate, or 0 when it
 * cannot be parsed (the caller then uses a short fallback).
 */
export function parseCertValidBefore(signedKey: string): number {
  try {
    const parts = signedKey.trim().split(/\s+/);
    if (parts.length < 2) return 0;
    const certType = parts[0];
    const blob = Buffer.from(parts[1], "base64");

    let pos = 0;
    const skipString = (): void => {
      const len = blob.readUInt32BE(pos);
      pos += 4 + len;
    };
    const readUint64 = (): number => {
      const hi = blob.readUInt32BE(pos);
      const lo = blob.readUInt32BE(pos + 4);
      pos += 8;
      return hi * 0x100000000 + lo;
    };

    skipString(); // format id
    skipString(); // nonce

    let keyFields: number;
    if (certType.startsWith("ssh-ed25519")) keyFields = 1;
    else if (certType.startsWith("ecdsa-sha2-")) keyFields = 2;
    else if (certType.startsWith("ssh-rsa")) keyFields = 2;
    else if (certType.startsWith("ssh-dss")) keyFields = 4;
    else if (certType.startsWith("sk-ssh-ed25519")) keyFields = 2;
    else if (certType.startsWith("sk-ecdsa-sha2-")) keyFields = 3;
    else return 0;
    for (let i = 0; i < keyFields; i++) skipString();

    readUint64(); // serial
    pos += 4; // type
    skipString(); // key id
    skipString(); // valid principals
    readUint64(); // valid after
    return readUint64();
  } catch {
    return 0;
  }
}
