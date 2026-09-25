/**
 * Reading and checking PEM certificates with node's own X509 parser, so none
 * of this needs the openssl binary.
 */

import { X509Certificate, createPrivateKey } from "crypto";

export interface TlsCertificateInfo {
  subject: string;
  issuer: string;
  names: string[];
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
  fingerprint: string;
}

export class TlsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TlsValidationError";
  }
}

const PEM_CERT =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** The leaf is the first certificate in a full chain. */
function splitPemChain(pem: string): string[] {
  return pem.match(PEM_CERT) ?? [];
}

function parseNames(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  return subjectAltName
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => {
      const match = /^(DNS|IP Address):(.+)$/.exec(entry);
      return match ? match[2].trim() : null;
    })
    .filter((name): name is string => !!name);
}

function isSelfSigned(cert: X509Certificate): boolean {
  if (cert.subject !== cert.issuer) return false;
  try {
    return cert.checkIssued(cert) && cert.verify(cert.publicKey);
  } catch {
    return false;
  }
}

function describeCertificate(cert: X509Certificate): TlsCertificateInfo {
  return {
    subject: cert.subject.replace(/\n/g, ", "),
    issuer: cert.issuer.replace(/\n/g, ", "),
    names: parseNames(cert.subjectAltName),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
    selfSigned: isSelfSigned(cert),
    fingerprint: cert.fingerprint256,
  };
}

/** Parses the leaf of a PEM chain. Null when there is nothing readable. */
export function readCertificateInfo(pem: string): TlsCertificateInfo | null {
  const [leaf] = splitPemChain(pem);
  if (!leaf) return null;
  try {
    return describeCertificate(new X509Certificate(leaf));
  } catch {
    return null;
  }
}

/**
 * Throws TlsValidationError unless the chain parses, the leaf is still valid
 * and the key belongs to it. Returns the leaf's details.
 */
export function validateCertificatePair(
  certificatePem: string,
  privateKeyPem: string,
  now: Date = new Date(),
): TlsCertificateInfo {
  if (typeof certificatePem !== "string" || typeof privateKeyPem !== "string") {
    throw new TlsValidationError(
      "A PEM certificate and private key are required",
    );
  }

  const chain = splitPemChain(certificatePem);
  if (chain.length === 0) {
    throw new TlsValidationError("The certificate is not PEM data");
  }

  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(chain[0]);
    for (const extra of chain.slice(1)) new X509Certificate(extra);
  } catch {
    throw new TlsValidationError("The certificate could not be parsed");
  }

  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new TlsValidationError("The private key could not be parsed");
  }

  if (!leaf.checkPrivateKey(key)) {
    throw new TlsValidationError(
      "The certificate and private key do not match",
    );
  }

  if (new Date(leaf.validTo).getTime() <= now.getTime()) {
    throw new TlsValidationError("The certificate has expired");
  }

  return describeCertificate(leaf);
}
