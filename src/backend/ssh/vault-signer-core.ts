// Pure (DB-free) HashiCorp Vault SSH signer logic: ephemeral key generation,
// the Vault OIDC HTTP flow, certificate signing, and certificate parsing.
//
// Kept separate from vault-signer-auth.ts (which adds the encrypted per-user
// certificate cache) so this layer can be unit-tested without the native SQLite
// dependency.

import crypto from "crypto";
import ssh2Pkg from "ssh2";
import { sshLogger } from "../utils/logger.js";

const { utils: ssh2Utils } = ssh2Pkg;

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

async function vaultRequest(
  url: string,
  method: "GET" | "POST" | "PUT",
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `Failed to reach Vault at ${url}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const text = await response.text();
  let json: any;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // leave undefined for non-JSON bodies
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

/** Generate an ephemeral SSH keypair in OpenSSH format. */
export function generateEphemeralKeyPair(
  keyType?: string | null,
): EphemeralKeyPair {
  let ssh2Type: "ed25519" | "rsa" | "ecdsa" = "ed25519";
  const options: { bits?: number } = {};
  switch ((keyType || "ssh-ed25519").trim()) {
    case "ssh-rsa":
      ssh2Type = "rsa";
      options.bits = 4096;
      break;
    case "ecdsa-sha2-nistp256":
      ssh2Type = "ecdsa";
      options.bits = 256;
      break;
    case "ssh-ed25519":
    default:
      ssh2Type = "ed25519";
      break;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pair = ssh2Utils.generateKeyPairSync(ssh2Type as any, options);
  return { privateKey: pair.private, publicKey: pair.public };
}

/**
 * Start a Vault OIDC login: returns the IdP auth URL plus the state/nonce
 * needed to complete the callback. `redirectUri` must be allowed both by the
 * Vault role's allowed_redirect_uris and by the IdP.
 */
export async function startVaultOidc(
  profile: VaultProfileConfig,
  redirectUri: string,
): Promise<{ authUrl: string; state: string; clientNonce: string }> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.oidcMount, "oidc");
  const clientNonce = crypto.randomBytes(20).toString("hex");

  const json = await vaultRequest(
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

  // Vault embeds the state it generated in the auth_url; we need it to correlate
  // the browser callback back to this login attempt.
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

/** Complete the Vault OIDC callback and return a short-lived Vault token. */
export async function completeVaultOidc(
  profile: VaultProfileConfig,
  params: { state: string; code: string; clientNonce: string },
): Promise<string> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.oidcMount, "oidc");

  const url = new URL(`${addr}/v1/auth/${mount}/oidc/callback`);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code", params.code);
  url.searchParams.set("client_nonce", params.clientNonce);

  const json = await vaultRequest(url.toString(), "GET", vaultHeaders(profile));
  const token: string | undefined = json?.auth?.client_token;
  if (!token) {
    throw new Error("Vault OIDC callback did not return a client token");
  }
  return token;
}

/** Sign an SSH public key with Vault, returning the OpenSSH certificate line. */
export async function signWithVault(
  profile: VaultProfileConfig,
  vaultToken: string,
  publicKey: string,
): Promise<string> {
  const addr = normalizeAddr(profile.vaultAddr);
  const mount = trimMount(profile.sshMount, "ssh-client-signer");

  const headers = { ...vaultHeaders(profile), "X-Vault-Token": vaultToken };
  const body: Record<string, unknown> = {
    public_key: publicKey.trim(),
    cert_type: "user",
  };
  if (profile.validPrincipals?.trim()) {
    body.valid_principals = profile.validPrincipals.trim();
  }

  const json = await vaultRequest(
    `${addr}/v1/${mount}/sign/${encodeURIComponent(profile.sshRole.trim())}`,
    "POST",
    headers,
    body,
  );
  const signedKey: string | undefined = json?.data?.signed_key;
  if (!signedKey) {
    throw new Error("Vault sign response did not include a signed_key");
  }
  return signedKey.trim();
}

/**
 * Parse the "valid before" Unix timestamp out of an OpenSSH certificate.
 * Returns 0 if it can't be parsed (caller falls back to a conservative TTL).
 */
export function parseCertValidBefore(signedKey: string): number {
  try {
    const parts = signedKey.trim().split(/\s+/);
    if (parts.length < 2) return 0;
    const certType = parts[0];
    const blob = Buffer.from(parts[1], "base64");

    let pos = 0;
    const readString = (): void => {
      const len = blob.readUInt32BE(pos);
      pos += 4 + len;
    };
    const readUint64 = (): number => {
      const hi = blob.readUInt32BE(pos);
      const lo = blob.readUInt32BE(pos + 4);
      pos += 8;
      return hi * 0x100000000 + lo;
    };

    readString(); // format id
    readString(); // nonce

    let keyFields: number;
    if (certType.startsWith("ssh-ed25519")) keyFields = 1;
    else if (certType.startsWith("ecdsa-sha2-")) keyFields = 2;
    else if (certType.startsWith("ssh-rsa")) keyFields = 2;
    else if (certType.startsWith("ssh-dss")) keyFields = 4;
    else if (certType.startsWith("sk-ssh-ed25519")) keyFields = 2;
    else if (certType.startsWith("sk-ecdsa-sha2-")) keyFields = 3;
    else return 0;
    for (let i = 0; i < keyFields; i++) readString();

    readUint64(); // serial
    pos += 4; // type (uint32)
    readString(); // key id
    readString(); // valid principals
    readUint64(); // valid after
    return readUint64(); // valid before
  } catch (e) {
    sshLogger.warn("Failed to parse Vault-signed certificate expiry", {
      operation: "vault_cert_parse",
      error: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}
