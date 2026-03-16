import crypto from "crypto";
import type { ConnectConfig, CipherAlgorithm } from "ssh2";

// Maps SSH cipher names to their OpenSSL equivalents (as used by ssh2 internally)
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

const availableCiphers = new Set(crypto.getCiphers());

function filterCiphers(list: CipherAlgorithm[]): CipherAlgorithm[] {
  return list.filter((name) => {
    const sslName = SSH_CIPHER_SSL_NAME[name];
    return !sslName || availableCiphers.has(sslName);
  });
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
