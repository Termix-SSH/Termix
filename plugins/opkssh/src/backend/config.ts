import { promises as fs } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

export const CONFIG_FILE = "config.yml";

const DOCS_URL = "https://docs.termix.site/features/authentication/opkssh";
const OPKSSH_DOCS_URL =
  "https://github.com/openpubkey/opkssh/blob/main/docs/config.md";

const TEMPLATE = `
# OPKSSH Configuration
# OPKSSH Documentation: ${OPKSSH_DOCS_URL}
# Termix Documentation: ${DOCS_URL}
`;

export interface ProviderInfo {
  alias: string;
  issuer: string;
  redirectUris: string[];
}

export type ConfigCheck =
  | { ok: true; configPath: string; providers: ProviderInfo[] }
  | { ok: false; configPath: string; error: string };

function dockerHint(): string {
  const dataDir = process.env.DATA_DIR;
  return dataDir && dataDir.startsWith("/app")
    ? "\n\nDocker: Ensure /app/data is mounted as a volume with write permissions for node:node user."
    : "";
}

/** Providers with an alias and issuer; issuers lose their scheme. */
export function parseProviders(content: string): ProviderInfo[] {
  const parsed = loadYaml(content) as {
    providers?: Array<{
      alias?: unknown;
      issuer?: unknown;
      redirect_uris?: unknown;
    }>;
  } | null;
  if (!parsed?.providers || !Array.isArray(parsed.providers)) return [];
  return parsed.providers
    .filter(
      (p) => typeof p?.alias === "string" && typeof p?.issuer === "string",
    )
    .map((p) => ({
      alias: p.alias as string,
      issuer: (p.issuer as string).replace(/^https?:\/\//, ""),
      redirectUris: Array.isArray(p.redirect_uris)
        ? p.redirect_uris.filter((u): u is string => typeof u === "string")
        : [],
    }));
}

/**
 * Reads the config, writing a template when there is none. The file must
 * have a providers section with at least one active provider.
 */
export async function checkConfig(configPath: string): Promise<ConfigCheck> {
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf8");
  } catch {
    try {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, TEMPLATE, "utf8");
    } catch {
      // Reported below either way.
    }
    return {
      ok: false,
      configPath,
      error: `OPKSSH configuration not found. A template config file has been created at:\n${configPath}\n\nPlease edit this file and configure your OIDC provider (Google, GitHub, Microsoft, etc.).\nSee documentation: ${OPKSSH_DOCS_URL}${dockerHint()}`,
    };
  }

  if (!content.includes("providers:")) {
    return {
      ok: false,
      configPath,
      error: `OPKSSH configuration is missing 'providers' section. Please edit the config file at:\n${configPath}`,
    };
  }

  const hasActiveProvider = content.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("- alias:") || trimmed.startsWith("issuer:");
  });
  if (!hasActiveProvider) {
    return {
      ok: false,
      configPath,
      error: `OPKSSH configuration has no active providers. Please edit the config file at:\n${configPath}\n\nUncomment and configure at least one OIDC provider.\nSee documentation: ${OPKSSH_DOCS_URL}${dockerHint()}`,
    };
  }

  let providers: ProviderInfo[] = [];
  try {
    providers = parseProviders(content);
  } catch {
    // OPKSSH reports a broken file itself when it starts.
  }
  return { ok: true, configPath, providers };
}

function isLocalHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return (
    bare === "localhost" ||
    bare === "127.0.0.1" ||
    bare === "::1" ||
    bare === "0:0:0:0:0:0:0:1" ||
    bare.startsWith("localhost:") ||
    bare.startsWith("127.0.0.1:")
  );
}

/**
 * OPKSSH's redirect_uris are the candidate ports for its own callback
 * listener on this server, so they must be localhost. The public URL the
 * identity provider redirects to is passed separately as
 * --remote-redirect-uri; it never goes in this field.
 */
export function validateRedirectUris(
  providers: ProviderInfo[],
  callbackUrl: string,
): { ok: true } | { ok: false; message: string } {
  const issues: string[] = [];
  for (const provider of providers) {
    const nonLocal = provider.redirectUris.filter((uri) => {
      try {
        return !isLocalHost(new URL(uri).hostname);
      } catch {
        return true;
      }
    });
    if (nonLocal.length > 0) {
      issues.push(
        `Provider '${provider.alias}': non-localhost entries in redirect_uris: ${nonLocal.join(", ")}`,
      );
    }
  }
  if (issues.length === 0) return { ok: true };
  return {
    ok: false,
    message:
      `OPKSSH configuration error: 'redirect_uris' must only contain localhost URLs.\n\n` +
      `${issues.join("\n")}\n\n` +
      `This field is OPKSSH's local callback listener, it must be localhost (or omitted to use ` +
      `the defaults http://localhost:3000/login-callback, :10001, :11110). ` +
      `The public Termix callback URL is supplied automatically by Termix via --remote-redirect-uri; ` +
      `you do not put it here. Register the public Termix URL with your OAuth provider instead ` +
      `(${callbackUrl}).\n\n` +
      `Fix: remove the non-localhost entries above, or delete the whole 'redirect_uris' block to use defaults.\n\n` +
      `Docs: ${DOCS_URL}`,
  };
}

export { DOCS_URL, OPKSSH_DOCS_URL };
