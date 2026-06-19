import crypto from "crypto";
import { createRequire } from "module";
import type {
  ConnectConfig,
  CipherAlgorithm,
  KexAlgorithm,
  ServerHostKeyAlgorithm,
  MacAlgorithm,
} from "ssh2";

const nativeRequire = createRequire(import.meta.url);
const availableCiphers = new Set(crypto.getCiphers());

// Maps SSH cipher names to their OpenSSL equivalents
const SSH_CIPHER_SSL_NAME: Partial<Record<CipherAlgorithm, string>> = {
  "chacha20-poly1305@openssh.com": "chacha20",
  "aes256-gcm@openssh.com": "aes-256-gcm",
  "aes128-gcm@openssh.com": "aes-128-gcm",
  "aes256-ctr": "aes-256-ctr",
  "aes192-ctr": "aes-192-ctr",
  "aes128-ctr": "aes-128-ctr",
  "aes256-cbc": "aes-256-cbc",
  "aes192-cbc": "aes-192-cbc",
  "aes128-cbc": "aes-128-cbc",
  "3des-cbc": "des-ede3-cbc",
};

// Check if ssh2's native crypto binding is available (needed for chacha20-poly1305)
let ssh2BindingAvailable = false;
try {
  nativeRequire("ssh2/lib/protocol/crypto/build/Release/sshcrypto.node");
  ssh2BindingAvailable = true;
} catch {
  try {
    // ESM fallback: check if chacha20 works via OpenSSL createCipheriv
    crypto.createCipheriv("chacha20", Buffer.alloc(32), Buffer.alloc(16));
    ssh2BindingAvailable = true;
  } catch {
    ssh2BindingAvailable = false;
  }
}

function filterCiphers(list: CipherAlgorithm[]): CipherAlgorithm[] {
  return list.filter((name) => {
    const sslName = SSH_CIPHER_SSL_NAME[name];
    if (!sslName) return true;
    if (!availableCiphers.has(sslName)) return false;
    // chacha20-poly1305 requires either native binding or working OpenSSL chacha20
    if (name === "chacha20-poly1305@openssh.com" && !ssh2BindingAvailable) {
      return false;
    }
    return true;
  });
}

const LEGACY_KEX: KexAlgorithm[] = [
  "diffie-hellman-group14-sha1",
  "diffie-hellman-group-exchange-sha1",
  "diffie-hellman-group1-sha1",
];

const LEGACY_SERVER_HOST_KEY: ServerHostKeyAlgorithm[] = ["ssh-rsa", "ssh-dss"];

const LEGACY_HMAC: MacAlgorithm[] = ["hmac-sha1", "hmac-md5"];

const LEGACY_CIPHER = filterCiphers(["3des-cbc"]);

export function buildSSHAlgorithms(
  allowLegacy: boolean,
): NonNullable<ConnectConfig["algorithms"]> {
  const kex: KexAlgorithm[] = [
    "curve25519-sha256",
    "curve25519-sha256@libssh.org",
    "ecdh-sha2-nistp521",
    "ecdh-sha2-nistp384",
    "ecdh-sha2-nistp256",
    "diffie-hellman-group-exchange-sha256",
    "diffie-hellman-group18-sha512",
    "diffie-hellman-group17-sha512",
    "diffie-hellman-group16-sha512",
    "diffie-hellman-group15-sha512",
    "diffie-hellman-group14-sha256",
  ];
  const serverHostKey: ServerHostKeyAlgorithm[] = [
    "ssh-ed25519",
    "ecdsa-sha2-nistp521",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp256",
    "rsa-sha2-512",
    "rsa-sha2-256",
  ];
  const hmac: MacAlgorithm[] = [
    "hmac-sha2-512-etm@openssh.com",
    "hmac-sha2-256-etm@openssh.com",
    "hmac-sha2-512",
    "hmac-sha2-256",
  ];
  const cipher = filterCiphers([
    "chacha20-poly1305@openssh.com",
    "aes256-gcm@openssh.com",
    "aes128-gcm@openssh.com",
    "aes256-ctr",
    "aes192-ctr",
    "aes128-ctr",
    "aes256-cbc",
    "aes192-cbc",
    "aes128-cbc",
  ]);

  if (allowLegacy) {
    kex.push(...LEGACY_KEX);
    serverHostKey.push(...LEGACY_SERVER_HOST_KEY);
    hmac.push(...LEGACY_HMAC);
    cipher.push(...LEGACY_CIPHER);
  }

  return {
    kex,
    serverHostKey,
    cipher,
    hmac,
    compress: ["none", "zlib@openssh.com", "zlib"],
  };
}

export const SSH_ALGORITHMS: NonNullable<ConnectConfig["algorithms"]> = {
  kex: [
    "curve25519-sha256",
    "curve25519-sha256@libssh.org",
    "ecdh-sha2-nistp521",
    "ecdh-sha2-nistp384",
    "ecdh-sha2-nistp256",
    "diffie-hellman-group-exchange-sha256",
    "diffie-hellman-group14-sha256",
    "diffie-hellman-group14-sha1",
    "diffie-hellman-group-exchange-sha1",
    "diffie-hellman-group1-sha1",
  ],
  serverHostKey: [
    "ssh-ed25519",
    "ecdsa-sha2-nistp521",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp256",
    "rsa-sha2-512",
    "rsa-sha2-256",
    "ssh-rsa",
    "ssh-dss",
  ],
  cipher: filterCiphers([
    "chacha20-poly1305@openssh.com",
    "aes256-gcm@openssh.com",
    "aes128-gcm@openssh.com",
    "aes256-ctr",
    "aes192-ctr",
    "aes128-ctr",
    "aes256-cbc",
    "aes192-cbc",
    "aes128-cbc",
    "3des-cbc",
  ]),
  hmac: [
    "hmac-sha2-512-etm@openssh.com",
    "hmac-sha2-256-etm@openssh.com",
    "hmac-sha2-512",
    "hmac-sha2-256",
    "hmac-sha1",
    "hmac-md5",
  ],
  compress: ["none", "zlib@openssh.com", "zlib"],
};
