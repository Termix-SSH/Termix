import { readFileSync } from "node:fs";
import tls from "node:tls";

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

let cached: string[] | undefined;

type TlsWithDefaults = typeof tls & {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

function systemCertificates(api: TlsWithDefaults = tls): string[] {
  try {
    return api.getCACertificates?.("system") ?? [];
  } catch {
    return [];
  }
}

/**
 * The certificates Termix adds to Node's own: the file NODE_EXTRA_CA_CERTS
 * names, and in the desktop app the system store too, which the app window
 * already trusts. The desktop app's fuses make Electron drop that variable
 * before the backend starts, and plugin processes never get it, so Termix
 * reads the certificates itself.
 */
export function extraCaCertificates(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
  system: () => string[] = systemCertificates,
): string[] {
  const desktop = env.ELECTRON_EMBEDDED === "true" ? system() : [];
  const file = env.NODE_EXTRA_CA_CERTS;
  if (!file) return desktop;
  try {
    return [...(read(file).match(PEM) ?? []), ...desktop];
  } catch {
    return desktop;
  }
}

/** Read once, since every plugin process start asks for them. */
export function cachedExtraCaCertificates(): string[] {
  cached ??= extraCaCertificates();
  return cached;
}

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
