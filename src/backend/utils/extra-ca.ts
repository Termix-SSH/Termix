import { readFileSync } from "node:fs";
import tls from "node:tls";

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

let cached: string[] | undefined;

/**
 * The certificates in the file NODE_EXTRA_CA_CERTS names. The desktop app's
 * fuses stop Electron reading that variable, and plugin processes never get
 * it, so Termix reads the file itself.
 */
export function extraCaCertificates(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string[] {
  const file = env.NODE_EXTRA_CA_CERTS;
  if (!file) return [];
  try {
    return read(file).match(PEM) ?? [];
  } catch {
    return [];
  }
}

/** Read once, since every plugin process start asks for them. */
export function cachedExtraCaCertificates(): string[] {
  cached ??= extraCaCertificates();
  return cached;
}

type TlsWithDefaults = typeof tls & {
  getCACertificates?: (type: "default") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

/** Adds certificates to the ones every TLS connection in this process trusts. */
export function trustExtraCertificates(
  certs: string[],
  api: TlsWithDefaults = tls,
): boolean {
  if (certs.length === 0) return false;
  if (
    typeof api.getCACertificates !== "function" ||
    typeof api.setDefaultCACertificates !== "function"
  ) {
    return false;
  }
  const current = api.getCACertificates("default");
  api.setDefaultCACertificates([...new Set([...current, ...certs])]);
  return true;
}
