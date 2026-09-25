/**
 * OpenSSH certificate auth for ssh2, which has no native support for it.
 *
 * Grafts the certificate onto the parsed key, converts ECDSA signatures from
 * DER to SSH wire format, and patches Protocol.authPK so the signature
 * wrapper carries the base algorithm (OpenSSH's sshkey_check_sigtype wants
 * that). Pure: no core state, it only touches the config and client it gets.
 *
 * Used by core key auth with a CA-signed certificate and by every plugin that
 * issues short-lived certificates (opkssh, step-ca, vault).
 */

import type {
  AnyAuthMethod,
  AuthHandlerMiddleware,
  AuthenticationType,
  Client,
  ConnectConfig,
  PublicKeyAuthMethod,
} from "ssh2";

type SignCallback = (
  data: Buffer,
  callback: (signature: Buffer) => void,
) => void;

interface ParsedPrivateKey {
  type: string;
  sign: (data: Buffer, algo?: string) => Buffer | Error;
  getPublicSSH: () => Buffer;
  [key: symbol]: unknown;
}

interface PatchedProtocol {
  authPK: (
    user: string,
    pubKey: ParsedPrivateKey,
    keyAlgo: string | undefined,
    cbSign?: SignCallback,
  ) => unknown;
  _kex: {
    sessionID: Buffer;
  };
  _packetRW: {
    write: {
      alloc: (payloadLength: number) => Buffer;
      allocStart: number;
      finalize: (packet: Buffer) => Buffer;
    };
  };
  _authsQueue: string[];
  _debug?: (message: string) => void;
  _cipher: {
    encrypt: (packet: Buffer) => void;
  };
}

type PatchedClient = Client & {
  _protocol?: PatchedProtocol;
};

type NextAuthHandler = (
  authInfo: AuthenticationType | AnyAuthMethod | false,
) => void;

// Grafts an OpenSSH certificate onto an already-parsed private key object and
// patches the ssh2 client so that certificate-based publickey auth succeeds.

async function applyCertToConnection(
  config: ConnectConfig,
  client: Client,
  privKey: ParsedPrivateKey,
  certStr: string,
): Promise<void> {
  // Extract cert type and blob from the stored certificate
  const certParts = certStr.trim().split(/\s+/);
  if (certParts.length < 2) {
    throw new Error(
      "Invalid certificate format: expected '<type> <base64>' string",
    );
  }
  const certType = certParts[0];
  const certBlob = Buffer.from(certParts[1], "base64");

  // Graft cert type and blob onto the parsed private key
  privKey.type = certType;
  const pubSSHSym = Object.getOwnPropertySymbols(privKey).find(
    (s) => String(s) === "Symbol(Public key SSH)",
  );
  if (!pubSSHSym) {
    throw new Error(
      "Cannot find public SSH symbol on parsed key; ssh2 internals may have changed",
    );
  }
  privKey[pubSSHSym] = certBlob;

  // Wrap sign() for ECDSA cert keys (DER → SSH wire format)
  if (privKey.type.startsWith("ecdsa-")) {
    const origSign = privKey.sign.bind(privKey);
    privKey.sign = (data: Buffer, algo?: string) => {
      const sigAlgo = algo?.includes("-cert-")
        ? algo.replace(/-cert-v\d+@openssh\.com$/, "")
        : algo;
      const sig = origSign(data, sigAlgo);
      if (sig instanceof Error || sig[0] !== 0x30) return sig;
      // Convert DER-encoded ECDSA signature to SSH wire format
      try {
        let pos = 2;
        if (sig[1] & 0x80) pos += sig[1] & 0x7f;
        pos++;
        const rLen = sig[pos++];
        const r = sig.subarray(pos, pos + rLen);
        pos += rLen + 1;
        const sLen = sig[pos++];
        const s = sig.subarray(pos, pos + sLen);
        const out = Buffer.allocUnsafe(4 + r.length + 4 + s.length);
        out.writeUInt32BE(r.length, 0);
        r.copy(out, 4);
        out.writeUInt32BE(s.length, 4 + r.length);
        s.copy(out, 4 + r.length + 4);
        return out;
      } catch {
        return sig;
      }
    };
  }

  // Set up authHandler to bypass ssh2's cert type rejection
  let certAuthAttempted = false;
  const authHandler: AuthHandlerMiddleware = (
    methodsLeft: string[],
    _partialSuccess: boolean,
    callback,
  ) => {
    const next = callback as NextAuthHandler;
    if (
      !certAuthAttempted &&
      (!methodsLeft || methodsLeft.includes("publickey"))
    ) {
      certAuthAttempted = true;
      next({
        type: "publickey",
        username: (config as Record<string, unknown>).username as string,
        key: privKey as unknown as PublicKeyAuthMethod["key"],
      });
    } else {
      next(false);
    }
  };
  config.authHandler = authHandler;

  // Monkey-patch Protocol.authPK after connect() to fix the signature
  // wrapper algorithm for cert types.
  const baseAlgo = certType.replace(/-cert-v\d+@openssh\.com$/, "");
  const origConnect = client.connect.bind(client);
  const patchedClient = client as PatchedClient;
  patchedClient.connect = (cfg: ConnectConfig) => {
    const connectedClient = origConnect(cfg);
    const proto = patchedClient._protocol;
    if (!proto) return connectedClient;
    const origAuthPK = proto.authPK.bind(proto);
    proto.authPK = (
      user: string,
      pubKey: ParsedPrivateKey,
      keyAlgo: string | undefined,
      cbSign?: SignCallback,
    ) => {
      const isCertAuth = !!cbSign && pubKey?.type?.includes("-cert-");
      if (!isCertAuth) {
        return origAuthPK(user, pubKey, keyAlgo, cbSign);
      }

      // Signed auth with cert type: rebuild packet with base algo in
      // the signature wrapper. keyAlgo may be undefined for ECDSA.
      const certAlgo = keyAlgo || pubKey.type;
      const pubSSH = pubKey.getPublicSSH();
      const sessionID = proto._kex.sessionID;
      const sesLen = sessionID.length;
      const userLen = Buffer.byteLength(user);
      const certAlgoLen = Buffer.byteLength(certAlgo);
      const baseAlgoLen = Buffer.byteLength(baseAlgo);
      const pubKeyLen = pubSSH.length;

      // Build data to sign (uses the cert algo, which the server verifies against)
      const sigDataLen =
        4 +
        sesLen +
        1 +
        4 +
        userLen +
        4 +
        14 +
        4 +
        9 +
        1 +
        4 +
        certAlgoLen +
        4 +
        pubKeyLen;
      const sigData = Buffer.allocUnsafe(sigDataLen);
      let sp = 0;
      sigData.writeUInt32BE(sesLen, sp);
      sp += 4;
      sessionID.copy(sigData, sp);
      sp += sesLen;
      sigData[sp++] = 50; // SSH_MSG_USERAUTH_REQUEST
      sigData.writeUInt32BE(userLen, sp);
      sp += 4;
      sigData.write(user, sp, userLen, "utf8");
      sp += userLen;
      sigData.writeUInt32BE(14, sp);
      sp += 4;
      sigData.write("ssh-connection", sp, 14, "utf8");
      sp += 14;
      sigData.writeUInt32BE(9, sp);
      sp += 4;
      sigData.write("publickey", sp, 9, "utf8");
      sp += 9;
      sigData[sp++] = 1; // TRUE
      sigData.writeUInt32BE(certAlgoLen, sp);
      sp += 4;
      sigData.write(certAlgo, sp, certAlgoLen, "utf8");
      sp += certAlgoLen;
      sigData.writeUInt32BE(pubKeyLen, sp);
      sp += 4;
      pubSSH.copy(sigData, sp);

      cbSign(sigData, (signature: Buffer) => {
        const sigLen = signature.length;
        const payloadLen =
          1 +
          4 +
          userLen +
          4 +
          14 +
          4 +
          9 +
          1 +
          4 +
          certAlgoLen +
          4 +
          pubKeyLen +
          4 +
          4 +
          baseAlgoLen +
          4 +
          sigLen;
        const packet = proto._packetRW.write.alloc(payloadLen);
        let pp = proto._packetRW.write.allocStart;
        packet[pp] = 50; // SSH_MSG_USERAUTH_REQUEST
        packet.writeUInt32BE(userLen, ++pp);
        pp += 4;
        packet.write(user, pp, userLen, "utf8");
        pp += userLen;
        packet.writeUInt32BE(14, pp);
        pp += 4;
        packet.write("ssh-connection", pp, 14, "utf8");
        pp += 14;
        packet.writeUInt32BE(9, pp);
        pp += 4;
        packet.write("publickey", pp, 9, "utf8");
        pp += 9;
        packet[pp++] = 1; // TRUE
        // Header: cert type
        packet.writeUInt32BE(certAlgoLen, pp);
        pp += 4;
        packet.write(certAlgo, pp, certAlgoLen, "utf8");
        pp += certAlgoLen;
        // Public key blob
        packet.writeUInt32BE(pubKeyLen, pp);
        pp += 4;
        pubSSH.copy(packet, pp);
        pp += pubKeyLen;
        // Signature wrapper: base algo (NOT cert type)
        packet.writeUInt32BE(4 + baseAlgoLen + 4 + sigLen, pp);
        pp += 4;
        packet.writeUInt32BE(baseAlgoLen, pp);
        pp += 4;
        packet.write(baseAlgo, pp, baseAlgoLen, "utf8");
        pp += baseAlgoLen;
        packet.writeUInt32BE(sigLen, pp);
        pp += 4;
        signature.copy(packet, pp);

        proto._authsQueue.push("publickey");
        proto._debug?.("Outbound: Sending USERAUTH_REQUEST (publickey)");
        const finalized = proto._packetRW.write.finalize(packet);
        proto._cipher.encrypt(finalized);
      });
    };
    return connectedClient;
  };
}

export interface CertificateCredentials {
  /** OpenSSH or PEM private key. */
  privateKey: Buffer | string;
  /** The certificate line, e.g. "ssh-ed25519-cert-v01@openssh.com AAAA...". */
  certificate: string;
  passphrase?: string;
}

/**
 * Sets up certificate publickey auth on an ssh2 client. Call before
 * `client.connect(config)`; it sets `config.authHandler` and
 * `config.username`.
 */
export async function applyCertificateAuth(
  config: ConnectConfig,
  client: Client,
  credentials: CertificateCredentials,
  username: string,
): Promise<void> {
  const { createRequire } = await import("node:module");
  const esmRequire = createRequire(import.meta.url);
  const {
    utils: { parseKey },
  } = esmRequire("ssh2");

  (config as Record<string, unknown>).username = username;

  const keyBuf = Buffer.isBuffer(credentials.privateKey)
    ? credentials.privateKey
    : Buffer.from(credentials.privateKey, "utf8");
  const parsed = credentials.passphrase
    ? parseKey(keyBuf, credentials.passphrase)
    : parseKey(keyBuf);

  if (parsed instanceof Error || !parsed) {
    const reason = parsed instanceof Error ? parsed.message : "unknown error";
    throw new Error(
      `Failed to parse private key for certificate auth: ${reason}`,
    );
  }
  const privKey = (
    Array.isArray(parsed) ? parsed[0] : parsed
  ) as ParsedPrivateKey;

  await applyCertToConnection(config, client, privKey, credentials.certificate);
}
