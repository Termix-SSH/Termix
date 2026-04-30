// OPKSSH certificate authentication workarounds for ssh2.
// ssh2 doesn't support OpenSSH cert auth natively — this module grafts
// the certificate onto the parsed key, wraps ECDSA signing to convert
// DER → SSH wire format, and patches Protocol.authPK to use the base
// algorithm in the signature wrapper (required by OpenSSH's sshkey_check_sigtype).

import type {
  AnyAuthMethod,
  AuthHandlerMiddleware,
  AuthenticationType,
  Client,
  ConnectConfig,
  PublicKeyAuthMethod,
} from "ssh2";

interface OPKSSHToken {
  privateKey: string;
  sshCert: string;
}

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

interface OPKSSHProtocol {
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

type OPKSSHClient = Client & {
  _protocol?: OPKSSHProtocol;
};

type OPKSSHNextAuthHandler = (
  authInfo: AuthenticationType | AnyAuthMethod | false,
) => void;

export async function setupOPKSSHCertAuth(
  config: ConnectConfig,
  client: Client,
  token: OPKSSHToken,
  username: string,
): Promise<void> {
  const { createRequire } = await import("node:module");
  const esmRequire = createRequire(import.meta.url);
  const {
    utils: { parseKey },
  } = esmRequire("ssh2");

  const parsed = parseKey(Buffer.from(token.privateKey));
  if (parsed instanceof Error || !parsed) {
    throw new Error("Failed to parse OPKSSH private key");
  }
  const privKey = (
    Array.isArray(parsed) ? parsed[0] : parsed
  ) as ParsedPrivateKey;

  // Extract cert type and blob from the stored certificate
  const certParts = token.sshCert.trim().split(/\s+/);
  const certType = certParts[0];
  privKey.type = certType;
  const certBlob = Buffer.from(certParts[1], "base64");

  // Replace the internal public SSH blob with the full certificate
  const pubSSHSym = Object.getOwnPropertySymbols(privKey).find(
    (s) => String(s) === "Symbol(Public key SSH)",
  );
  if (!pubSSHSym) {
    throw new Error(
      "Cannot find public SSH symbol on parsed key, ssh2 internals may have changed",
    );
  }
  privKey[pubSSHSym] = certBlob;

  // Wrap sign() for ECDSA cert keys
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
    const next = callback as OPKSSHNextAuthHandler;
    if (
      !certAuthAttempted &&
      (!methodsLeft || methodsLeft.includes("publickey"))
    ) {
      certAuthAttempted = true;
      next({
        type: "publickey",
        username,
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
  const patchedClient = client as OPKSSHClient;
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

      // Build data to sign (uses cert algo — matches server verification)
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
