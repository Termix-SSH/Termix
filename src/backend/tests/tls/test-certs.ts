/** Throwaway certificates for the TLS tests, made in-process. */

import "reflect-metadata";

import { webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const DAY = 86_400_000;

export interface TestPair {
  certificate: string;
  privateKey: string;
}

async function keys(): Promise<webcrypto.CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey(ALG, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
}

async function keyPem(key: webcrypto.CryptoKey): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", key));
  const body = der
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

function sans(names: string[]) {
  return new x509.SubjectAlternativeNameExtension(
    names.map((value) => ({ type: "dns" as const, value })),
  );
}

export async function selfSignedPair(
  name = "localhost",
  options: { daysLeft?: number } = {},
): Promise<TestPair> {
  const pair = await keys();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${name}`,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + (options.daysLeft ?? 365) * DAY),
    keys: pair,
    signingAlgorithm: ALG,
    extensions: [sans([name])],
  });
  return {
    certificate: cert.toString("pem"),
    privateKey: await keyPem(pair.privateKey),
  };
}

/** A leaf signed by a throwaway CA, like one from Let's Encrypt. */
export async function caIssuedPair(
  name = "termix.example.com",
  options: { daysLeft?: number } = {},
): Promise<TestPair> {
  const caKeys = await keys();
  const leafKeys = await keys();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: `CN=${name}`,
    issuer: "CN=Test CA",
    notBefore: new Date(Date.now() - 2 * DAY),
    notAfter: new Date(Date.now() + (options.daysLeft ?? 90) * DAY),
    signingKey: caKeys.privateKey,
    publicKey: leafKeys.publicKey,
    signingAlgorithm: ALG,
    extensions: [sans([name])],
  });
  return {
    certificate: cert.toString("pem"),
    privateKey: await keyPem(leafKeys.privateKey),
  };
}
