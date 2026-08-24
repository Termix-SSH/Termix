import crypto from "crypto";
import { safeOutboundFetch } from "./safe-outbound-fetch.js";

/**
 * A minimal client for smallstep's step-ca SSH user-certificate flow, done
 * over its HTTP API rather than the `step` binary:
 *
 *   1. bootstrap the CA's root certificate by fingerprint (GET /root/{fp})
 *   2. read the OIDC provisioner's client settings (GET /provisioners)
 *   3. run the OIDC authorization-code flow against the provider
 *   4. POST the id_token as the one-time token to /1.0/ssh/sign
 */

export interface StepCaTarget {
  caUrl: string;
  fingerprint: string;
  /** Hosts the SSRF guard may reach even when they resolve to private ranges. */
  allowedPrivateHosts: readonly string[];
}

export interface StepCaOidcProvisioner {
  name: string;
  clientID: string;
  clientSecret?: string;
  configurationEndpoint: string;
}

export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

const FETCH_TIMEOUT_MS = 15_000;

/** Display-only claims; the CA is the component that verifies the token. */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export function normalizeCaUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") {
    throw new Error("Step CA URL must use https");
  }
  return url.toString().replace(/\/+$/, "");
}

export function normalizeFingerprint(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 64) {
    throw new Error("CA fingerprint must be a SHA-256 hex digest");
  }
  return hex;
}

export function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

export function certificateFingerprint(pem: string): string {
  return crypto.createHash("sha256").update(pemToDer(pem)).digest("hex");
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${what} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * The root endpoint is served under the CA's own TLS certificate, which
 * nothing trusts yet - so this one request skips verification and trusts
 * the fingerprint instead, exactly like `step ca bootstrap`.
 */
export async function fetchRootCertificate(
  target: StepCaTarget,
): Promise<string> {
  const fingerprint = normalizeFingerprint(target.fingerprint);
  const response = await safeOutboundFetch(
    `${normalizeCaUrl(target.caUrl)}/root/${fingerprint}`,
    { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    target.allowedPrivateHosts,
    { rejectUnauthorized: false },
  );
  const { ca } = await readJson<{ ca?: string }>(
    response,
    "Fetching the CA root",
  );
  if (!ca || certificateFingerprint(ca) !== fingerprint) {
    throw new Error("CA root certificate does not match the fingerprint");
  }
  return ca;
}

export async function findOidcProvisioner(
  target: StepCaTarget,
  rootPem: string,
  name: string,
): Promise<StepCaOidcProvisioner> {
  const base = normalizeCaUrl(target.caUrl);
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const response = await safeOutboundFetch(
      `${base}/provisioners?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      target.allowedPrivateHosts,
      { ca: rootPem },
    );
    const body = await readJson<{
      provisioners?: Array<Record<string, unknown>>;
      nextCursor?: string;
    }>(response, "Listing CA provisioners");
    const match = (body.provisioners ?? []).find(
      (p) => p.name === name && p.type === "OIDC",
    );
    if (match) {
      if (
        typeof match.clientID !== "string" ||
        typeof match.configurationEndpoint !== "string"
      ) {
        throw new Error("The OIDC provisioner is missing its client settings");
      }
      return {
        name,
        clientID: match.clientID,
        clientSecret:
          typeof match.clientSecret === "string"
            ? match.clientSecret
            : undefined,
        configurationEndpoint: match.configurationEndpoint,
      };
    }
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  throw new Error(`OIDC provisioner "${name}" not found on the CA`);
}

export async function discoverOidcEndpoints(
  configurationEndpoint: string,
  allowedPrivateHosts: readonly string[],
): Promise<OidcEndpoints> {
  const response = await safeOutboundFetch(
    configurationEndpoint,
    { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    allowedPrivateHosts,
  );
  const doc = await readJson<{
    authorization_endpoint?: string;
    token_endpoint?: string;
  }>(response, "OIDC discovery");
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document is incomplete");
  }
  return {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
  };
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForIdToken(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  allowedPrivateHosts: readonly string[];
}): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) form.set("client_secret", input.clientSecret);
  const response = await safeOutboundFetch(
    input.tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    input.allowedPrivateHosts,
  );
  const body = await readJson<{ id_token?: string }>(
    response,
    "OIDC token exchange",
  );
  if (!body.id_token) {
    throw new Error("The identity provider returned no id_token");
  }
  return body.id_token;
}

// --- SSH keys and certificates ---------------------------------------------

function sshString(value: Buffer | string): Buffer {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, data]);
}

export function generateSshKeyPair(): {
  publicKeyLine: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]);
  return {
    publicKeyLine: `ssh-ed25519 ${blob.toString("base64")}`,
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
}

export async function signSshCertificate(
  target: StepCaTarget,
  rootPem: string,
  input: {
    publicKeyLine: string;
    ott: string;
    principals: string[];
    keyId: string;
  },
): Promise<string> {
  const blob = input.publicKeyLine.trim().split(/\s+/)[1];
  if (!blob) throw new Error("Invalid public key line");
  const response = await safeOutboundFetch(
    `${normalizeCaUrl(target.caUrl)}/1.0/ssh/sign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: blob,
        ott: input.ott,
        certType: "user",
        principals: input.principals,
        keyID: input.keyId,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    target.allowedPrivateHosts,
    { ca: rootPem },
  );
  if (!response.ok) {
    let detail = "";
    try {
      const err = (await response.json()) as { message?: string };
      detail = err.message ? `: ${err.message}` : "";
    } catch {
      /* no body */
    }
    throw new Error(
      `The CA refused to sign the key (HTTP ${response.status})${detail}`,
    );
  }
  const body = (await response.json()) as { crt?: string };
  if (!body.crt) throw new Error("The CA returned no certificate");
  return body.crt.trim();
}

export interface SshCertificateInfo {
  keyType: string;
  publicKeyLine: string;
  keyId: string;
  principals: string[];
  validAfter: Date;
  validBefore: Date;
}

/** Reads the identity and validity window out of an OpenSSH certificate line. */
export function parseSshCertificate(line: string): SshCertificateInfo {
  const blob = Buffer.from(line.trim().split(/\s+/)[1] ?? "", "base64");
  if (blob.length === 0) throw new Error("Invalid SSH certificate");
  let offset = 0;
  const readString = (): Buffer => {
    if (offset + 4 > blob.length) throw new Error("Truncated SSH certificate");
    const len = blob.readUInt32BE(offset);
    offset += 4;
    if (offset + len > blob.length) {
      throw new Error("Truncated SSH certificate");
    }
    const value = blob.subarray(offset, offset + len);
    offset += len;
    return value;
  };
  const readUint64 = (): bigint => {
    if (offset + 8 > blob.length) throw new Error("Truncated SSH certificate");
    const value = blob.readBigUInt64BE(offset);
    offset += 8;
    return value;
  };

  const keyType = readString().toString();
  if (!keyType.endsWith("-cert-v01@openssh.com")) {
    throw new Error("The CA returned a public key instead of a certificate");
  }
  readString(); // nonce
  // Public key fields differ by algorithm; consume them by shape.
  const publicKeyParts: Buffer[] = [];
  let plainKeyType: string;
  if (keyType.startsWith("ssh-rsa")) {
    plainKeyType = "ssh-rsa";
    publicKeyParts.push(readString(), readString()); // e, n
  } else if (keyType.startsWith("ecdsa-")) {
    plainKeyType = keyType.replace(/-cert-v01@openssh\.com$/, "");
    publicKeyParts.push(readString(), readString()); // curve, Q
  } else {
    plainKeyType = keyType.replace(/-cert-v01@openssh\.com$/, "");
    publicKeyParts.push(readString()); // ed25519 pk
  }
  const publicKeyBlob = Buffer.concat([
    sshString(plainKeyType),
    ...publicKeyParts.map(sshString),
  ]);
  readUint64(); // serial
  offset += 4; // type
  const keyId = readString().toString();
  const principalsBlob = readString();
  const principals: string[] = [];
  for (let p = 0; p < principalsBlob.length;) {
    if (p + 4 > principalsBlob.length) {
      throw new Error("Invalid SSH certificate principals");
    }
    const len = principalsBlob.readUInt32BE(p);
    if (p + 4 + len > principalsBlob.length) {
      throw new Error("Invalid SSH certificate principals");
    }
    principals.push(principalsBlob.subarray(p + 4, p + 4 + len).toString());
    p += 4 + len;
  }
  const validAfter = readUint64();
  const validBefore = readUint64();
  const toDate = (seconds: bigint) =>
    new Date(
      Number(seconds > 8_640_000_000_000n ? 8_640_000_000_000n : seconds) *
        1000,
    );
  return {
    keyType,
    publicKeyLine: `${plainKeyType} ${publicKeyBlob.toString("base64")}`,
    keyId,
    principals,
    validAfter: toDate(validAfter),
    validBefore: toDate(validBefore),
  };
}
