/**
 * Issuing a certificate with acme-client. Every request it makes goes through
 * ctx.fetch, so ACME traffic gets core's outbound guard and audit like any
 * other plugin request.
 */

import * as acme from "acme-client";
import type { PluginContext, PluginFetch } from "@termix/plugin-sdk/backend";
import { createTxtRecord } from "./cloudflare.js";
import { directoryUrlFor, type AcmeSettings } from "./settings.js";

const ACCOUNT_KEY = "account";
const DNS_PROPAGATION_MS = 30_000;

interface StoredAccount {
  directoryUrl: string;
  sealedKey: string;
  url: string | null;
}

export interface IssuedCertificate {
  certificate: string;
  privateKey: string;
}

type AxiosLikeConfig = {
  url?: string;
  method?: string;
  headers?: unknown;
  data?: unknown;
  timeout?: number;
  validateStatus?: ((status: number) => boolean) | null;
};

function plainHeaders(headers: unknown): Record<string, string> {
  const source =
    headers && typeof (headers as { toJSON?: unknown }).toJSON === "function"
      ? (headers as { toJSON: () => Record<string, unknown> }).toJSON()
      : ((headers ?? {}) as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number") {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * An axios adapter over ctx.fetch. It settles the way axios' own adapters do,
 * because acme-client's retry interceptor relies on a rejected error that
 * carries the response.
 */
export function createFetchAdapter(
  fetch: PluginFetch,
  allowPrivateHosts: readonly string[] = [],
) {
  return async (config: AxiosLikeConfig) => {
    const method = (config.method ?? "get").toUpperCase();
    const response = await fetch(String(config.url), {
      method,
      headers: plainHeaders(config.headers),
      body:
        config.data == null
          ? undefined
          : typeof config.data === "string"
            ? config.data
            : JSON.stringify(config.data),
      timeoutMs: config.timeout || 30_000,
      allowPrivateHosts,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const result = {
      data: method === "HEAD" ? "" : await response.text(),
      status: response.status,
      statusText: response.statusText,
      headers,
      config,
      request: {},
    };
    const validate = config.validateStatus;
    if (!result.status || !validate || validate(result.status)) return result;
    throw Object.assign(
      new Error(`Request failed with status code ${result.status}`),
      {
        isAxiosError: true,
        code: result.status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
        config,
        response: result,
      },
    );
  };
}

/** Private hosts a custom directory on the local network may use. */
function privateHostsFor(settings: AcmeSettings): string[] {
  if (settings.provider !== "custom") return [];
  try {
    return [new URL(settings.directoryUrl).hostname];
  } catch {
    return [];
  }
}

async function loadAccount(
  ctx: PluginContext,
  directoryUrl: string,
): Promise<{ key: string; url: string | null }> {
  const stored = (await ctx.kv.get(ACCOUNT_KEY)) as StoredAccount | null;
  if (stored && stored.directoryUrl === directoryUrl) {
    const key = await ctx.secrets.unseal(stored.sealedKey);
    if (key) return { key, url: stored.url };
  }
  const key = (await acme.crypto.createPrivateKey()).toString();
  await ctx.kv.set(ACCOUNT_KEY, {
    directoryUrl,
    sealedKey: await ctx.secrets.seal(key),
    url: null,
  } satisfies StoredAccount);
  return { key, url: null };
}

async function saveAccountUrl(
  ctx: PluginContext,
  directoryUrl: string,
  url: string,
): Promise<void> {
  const stored = (await ctx.kv.get(ACCOUNT_KEY)) as StoredAccount | null;
  if (!stored || stored.directoryUrl !== directoryUrl || stored.url === url) {
    return;
  }
  await ctx.kv.set(ACCOUNT_KEY, { ...stored, url });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one ACME order for `settings.domain` and returns the new pair. */
export async function issueCertificate(
  ctx: PluginContext,
  settings: AcmeSettings,
  options: { propagationMs?: number } = {},
): Promise<IssuedCertificate> {
  const directoryUrl = directoryUrlFor(settings);
  acme.axios.defaults.adapter = createFetchAdapter(
    ctx.fetch,
    privateHostsFor(settings),
  ) as never;

  const account = await loadAccount(ctx, directoryUrl);
  const client = new acme.Client({
    directoryUrl,
    accountKey: account.key,
    ...(account.url ? { accountUrl: account.url } : {}),
  });

  const [key, csr] = await acme.crypto.createCsr({
    commonName: settings.domain,
    altNames: [settings.domain],
  });

  const cleanups = new Map<string, () => void | Promise<void>>();
  const certificate = await client.auto({
    csr,
    email: settings.email,
    termsOfServiceAgreed: true,
    // Checking our own answer first needs port 80 or DNS from inside the
    // container, which often is not how the CA sees it.
    skipChallengeVerification: true,
    challengePriority:
      settings.challengeType === "dns-cloudflare" ? ["dns-01"] : ["http-01"],
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type === "http-01") {
        cleanups.set(
          challenge.token,
          await ctx.system.publishHttpChallenge(
            challenge.token,
            keyAuthorization,
          ),
        );
        return;
      }
      if (challenge.type === "dns-01") {
        cleanups.set(
          challenge.token,
          await createTxtRecord(
            ctx.fetch,
            settings.cloudflareToken,
            `_acme-challenge.${authz.identifier.value}`,
            keyAuthorization,
          ),
        );
        await sleep(options.propagationMs ?? DNS_PROPAGATION_MS);
        return;
      }
      throw new Error(
        `Unsupported challenge type ${(challenge as { type: string }).type}`,
      );
    },
    challengeRemoveFn: async (_authz, challenge) => {
      const cleanup = cleanups.get(challenge.token);
      cleanups.delete(challenge.token);
      try {
        await cleanup?.();
      } catch (error) {
        ctx.log.warn(
          `Could not clean up the ${challenge.type} challenge: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });

  await saveAccountUrl(ctx, directoryUrl, client.getAccountUrl());
  return { certificate, privateKey: key.toString() };
}
