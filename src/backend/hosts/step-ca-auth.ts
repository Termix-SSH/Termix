import { randomBytes } from "crypto";
import type { WebSocket } from "ws";
import { sshLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-message.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import {
  createCurrentOpksshTokenRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import { readStepCaPrivateAllowlist } from "../utils/step-ca-egress.js";
import {
  buildAuthorizationUrl,
  createPkce,
  discoverOidcEndpoints,
  exchangeCodeForIdToken,
  fetchRootCertificate,
  findOidcProvisioner,
  generateSshKeyPair,
  parseSshCertificate,
  signSshCertificate,
  type StepCaTarget,
} from "../utils/step-ca-client.js";

/**
 * Step CA (smallstep) SSH user certificates through its OIDC provisioner.
 *
 * Mirrors the OPKSSH flow and reuses its storage, WS messages and connect
 * path; the only difference is how the certificate is obtained: no binary,
 * just the CA's HTTP API plus one OIDC redirect back to Termix.
 */

export const STEP_CA_CALLBACK_PATH = "/host/step-ca-callback";
export const STEP_CA_SETTING_KEYS = {
  url: "step_ca_url",
  fingerprint: "step_ca_fingerprint",
  provisioner: "step_ca_provisioner",
} as const;

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const FALLBACK_CERT_LIFETIME_MS = 16 * 60 * 60 * 1000;

export interface StepCaSettings {
  caUrl: string;
  fingerprint: string;
  provisioner: string;
}

export async function readStepCaSettings(): Promise<StepCaSettings | null> {
  const settings = createCurrentSettingsRepository();
  const [caUrl, fingerprint, provisioner] = await Promise.all([
    settings.get(STEP_CA_SETTING_KEYS.url),
    settings.get(STEP_CA_SETTING_KEYS.fingerprint),
    settings.get(STEP_CA_SETTING_KEYS.provisioner),
  ]);
  if (!caUrl || !fingerprint || !provisioner) return null;
  return { caUrl, fingerprint, provisioner };
}

interface StepCaAuthSession {
  state: string;
  userId: string;
  hostId: number;
  username: string;
  ws: WebSocket;
  target: StepCaTarget;
  rootPem: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
  keyPair: { publicKeyLine: string; privateKeyPem: string };
  timeout: NodeJS.Timeout;
  completed: boolean;
}

const sessions = new Map<string, StepCaAuthSession>();

function send(ws: WebSocket, message: object): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    /* socket already gone */
  }
}

function endSession(session: StepCaAuthSession): void {
  clearTimeout(session.timeout);
  sessions.delete(session.state);
}

/** Display-only claims; the CA is the one that verifies the token. */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function startStepCaAuth(
  userId: string,
  hostId: number,
  username: string,
  ws: WebSocket,
  requestOrigin: string,
): Promise<void> {
  const settings = await readStepCaSettings();
  if (!settings) {
    send(ws, {
      type: "opkssh_config_error",
      requestId: "",
      error:
        "Step CA is not configured. An administrator must set the CA URL, root fingerprint and OIDC provisioner under Admin Settings.",
    });
    return;
  }

  const state = randomBytes(24).toString("base64url");
  try {
    const target: StepCaTarget = {
      caUrl: settings.caUrl,
      fingerprint: settings.fingerprint,
      allowedPrivateHosts: await readStepCaPrivateAllowlist(),
    };
    const rootPem = await fetchRootCertificate(target);
    const provisioner = await findOidcProvisioner(
      target,
      rootPem,
      settings.provisioner,
    );
    const endpoints = await discoverOidcEndpoints(
      provisioner.configurationEndpoint,
      target.allowedPrivateHosts,
    );
    const pkce = createPkce();
    const nonce = randomBytes(16).toString("base64url");
    const redirectUri = `${requestOrigin}${STEP_CA_CALLBACK_PATH}`;

    const session: StepCaAuthSession = {
      state,
      userId,
      hostId,
      username,
      ws,
      target,
      rootPem,
      clientId: provisioner.clientID,
      clientSecret: provisioner.clientSecret,
      tokenEndpoint: endpoints.tokenEndpoint,
      redirectUri,
      codeVerifier: pkce.verifier,
      nonce,
      keyPair: generateSshKeyPair(),
      completed: false,
      timeout: setTimeout(() => {
        const current = sessions.get(state);
        if (!current || current.completed) return;
        send(ws, { type: "opkssh_timeout", requestId: state });
        endSession(current);
      }, AUTH_TIMEOUT_MS),
    };
    sessions.set(state, session);
    ws.once("close", () => {
      const current = sessions.get(state);
      if (current && !current.completed) endSession(current);
    });

    send(ws, {
      type: "opkssh_status",
      requestId: state,
      stage: "chooser",
      label: "Step CA",
      url: buildAuthorizationUrl({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        clientId: provisioner.clientID,
        redirectUri,
        state,
        nonce,
        codeChallenge: pkce.challenge,
      }),
      providers: [],
    });
  } catch (error) {
    sshLogger.error("Failed to start Step CA authentication", error, {
      operation: "step_ca_start_error",
      userId,
      hostId,
    });
    send(ws, {
      type: "opkssh_error",
      requestId: state,
      error: `Step CA: ${getErrorMessage(error)}`,
    });
  }
}

export function cancelStepCaAuth(requestId: string): boolean {
  const session = sessions.get(requestId);
  if (!session) return false;
  endSession(session);
  return true;
}

/**
 * Finishes the flow once the identity provider redirects back: exchanges
 * the code, has the CA sign the key, stores the certificate the way OPKSSH
 * does (same table, same encryption, same token id) and tells the terminal
 * to reconnect.
 */
export async function completeStepCaAuth(query: {
  state?: string;
  code?: string;
  error?: string;
  error_description?: string;
}): Promise<{ ok: boolean; message: string }> {
  const session = query.state ? sessions.get(query.state) : undefined;
  if (!session) {
    return { ok: false, message: "This sign-in request is no longer active." };
  }
  if (query.error || !query.code) {
    const message = query.error_description || query.error || "Sign-in failed";
    send(session.ws, {
      type: "opkssh_error",
      requestId: session.state,
      error: `Step CA: ${message}`,
    });
    endSession(session);
    return { ok: false, message };
  }

  try {
    send(session.ws, {
      type: "opkssh_status",
      requestId: session.state,
      stage: "authenticating",
    });
    const idToken = await exchangeCodeForIdToken({
      tokenEndpoint: session.tokenEndpoint,
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      code: query.code,
      redirectUri: session.redirectUri,
      codeVerifier: session.codeVerifier,
      allowedPrivateHosts: session.target.allowedPrivateHosts,
    });
    const claims = decodeJwtClaims(idToken);
    if (claims.nonce !== undefined && claims.nonce !== session.nonce) {
      throw new Error("The identity token does not match this sign-in");
    }
    const email = typeof claims.email === "string" ? claims.email : undefined;

    const certificate = await signSshCertificate(
      session.target,
      session.rootPem,
      {
        publicKeyLine: session.keyPair.publicKeyLine,
        ott: idToken,
        principals: [session.username],
        keyId: email ?? session.username,
      },
    );

    let expiresAt = new Date(Date.now() + FALLBACK_CERT_LIFETIME_MS);
    try {
      expiresAt = parseSshCertificate(certificate).validBefore;
    } catch {
      /* an unparseable validity window falls back to the CA default */
    }

    const userDataKey = DataCrypto.getUserDataKey(session.userId);
    if (!userDataKey) throw new Error("User data key not found");
    // Same token id as OPKSSH: getOPKSSHToken decrypts with it.
    const tokenId = `opkssh-${session.userId}-${session.hostId}`;
    await createCurrentOpksshTokenRepository().upsert({
      userId: session.userId,
      hostId: session.hostId,
      sshCert: FieldCrypto.encryptField(
        certificate,
        userDataKey,
        tokenId,
        "ssh_cert",
      ),
      privateKey: FieldCrypto.encryptField(
        session.keyPair.privateKeyPem,
        userDataKey,
        tokenId,
        "private_key",
      ),
      email,
      sub: typeof claims.sub === "string" ? claims.sub : undefined,
      issuer: typeof claims.iss === "string" ? claims.iss : undefined,
      audience: typeof claims.aud === "string" ? claims.aud : undefined,
      expiresAt: expiresAt.toISOString(),
    });

    session.completed = true;
    send(session.ws, {
      type: "opkssh_completed",
      requestId: session.state,
      expiresAt: expiresAt.toISOString(),
    });
    endSession(session);
    return { ok: true, message: "Signed in. You can close this window." };
  } catch (error) {
    sshLogger.error("Step CA certificate issuance failed", error, {
      operation: "step_ca_complete_error",
      userId: session.userId,
      hostId: session.hostId,
    });
    const message = getErrorMessage(error);
    send(session.ws, {
      type: "opkssh_error",
      requestId: session.state,
      error: `Step CA: ${message}`,
    });
    endSession(session);
    return { ok: false, message };
  }
}
