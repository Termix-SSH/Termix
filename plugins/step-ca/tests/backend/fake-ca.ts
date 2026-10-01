import crypto from "node:crypto";
import type { PluginFetchInit } from "@termix/plugin-sdk/backend";

const CERT_TYPE = "ssh-ed25519-cert-v01@openssh.com";

function sshString(value: Buffer | string): Buffer {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, data]);
}

function uint64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(value, 0);
  return out;
}

function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
}

/** An ed25519 CA that signs OpenSSH user certificates, like step-ca does. */
export function createSshCa() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(
    (publicKey.export({ format: "jwk" }) as { x: string }).x,
    "base64url",
  );
  const caBlob = Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]);

  return {
    sign(input: {
      publicKeyBlob: string;
      keyId: string;
      principals: string[];
      validAfter: number;
      validBefore: number;
    }): string {
      const userBlob = Buffer.from(input.publicKeyBlob, "base64");
      // ssh-ed25519 blob: string type, string pk
      const pk = userBlob.subarray(4 + 11 + 4);
      const body = Buffer.concat([
        sshString(CERT_TYPE),
        sshString(crypto.randomBytes(32)),
        sshString(pk),
        uint64(1n),
        uint32(1),
        sshString(input.keyId),
        sshString(Buffer.concat(input.principals.map((p) => sshString(p)))),
        uint64(BigInt(input.validAfter)),
        uint64(BigInt(input.validBefore)),
        sshString(Buffer.alloc(0)),
        sshString(Buffer.alloc(0)),
        sshString(Buffer.alloc(0)),
        sshString(caBlob),
      ]);
      const signature = Buffer.concat([
        sshString("ssh-ed25519"),
        sshString(crypto.sign(null, body, privateKey)),
      ]);
      return `${CERT_TYPE} ${Buffer.concat([body, sshString(signature)]).toString("base64")}`;
    },
  };
}

/** A root "certificate" the client fingerprints by the sha256 of its DER. */
export function fakeRoot() {
  const der = crypto.randomBytes(128);
  return {
    pem: `-----BEGIN CERTIFICATE-----\n${der.toString("base64")}\n-----END CERTIFICATE-----\n`,
    fingerprint: crypto.createHash("sha256").update(der).digest("hex"),
  };
}

export function jwt(claims: Record<string, unknown>): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

export const CA_URL = "https://ca.test";
export const DISCOVERY_URL =
  "https://idp.test/.well-known/openid-configuration";

export interface FakeCaOptions {
  /** Principals the CA puts on the certificate; defaults to what was asked. */
  principals?: string[];
  /** Nonce the identity provider puts in the id token. */
  nonce: () => string;
  /** Status for /1.0/ssh/sign. */
  signStatus?: number;
}

/**
 * Answers ctx.fetch as a step-ca server plus its identity provider would.
 * Records every call so a test can check the TLS options.
 */
export function createFakeCa(options: FakeCaOptions) {
  const root = fakeRoot();
  const ca = createSshCa();
  const calls: Array<{ url: string; init?: PluginFetchInit }> = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetch = async (url: string, init?: PluginFetchInit) => {
    calls.push({ url, init });
    if (url === `${CA_URL}/root/${root.fingerprint}`) {
      return json({ ca: root.pem });
    }
    if (url.startsWith(`${CA_URL}/provisioners`)) {
      return json({
        provisioners: [
          { name: "jwk", type: "JWK" },
          {
            name: "oidc",
            type: "OIDC",
            clientID: "termix",
            configurationEndpoint: DISCOVERY_URL,
          },
        ],
      });
    }
    if (url === DISCOVERY_URL) {
      return json({
        authorization_endpoint: "https://idp.test/authorize",
        token_endpoint: "https://idp.test/token",
      });
    }
    if (url === "https://idp.test/token") {
      return json({
        id_token: jwt({ email: "alice@example.com", nonce: options.nonce() }),
      });
    }
    if (url === `${CA_URL}/1.0/ssh/sign`) {
      if (options.signStatus && options.signStatus !== 200) {
        return json({ message: "not allowed" }, options.signStatus);
      }
      const body = JSON.parse(init?.body ?? "{}");
      const now = Math.floor(Date.now() / 1000);
      return json({
        crt: ca.sign({
          publicKeyBlob: body.publicKey,
          keyId: body.keyID,
          principals: options.principals ?? body.principals,
          validAfter: now - 60,
          validBefore: now + 16 * 3600,
        }),
      });
    }
    return new Response("not found", { status: 404 });
  };

  return { fetch, calls, root, ca };
}
