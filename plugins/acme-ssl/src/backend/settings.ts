import type { PluginContext } from "@termix/plugin-sdk/backend";

export type AcmeProvider = "letsencrypt" | "letsencrypt-staging" | "custom";
export type AcmeChallengeType = "http-01" | "dns-cloudflare";

export interface AcmeSettings {
  autoRenew: boolean;
  domain: string;
  email: string;
  provider: AcmeProvider;
  directoryUrl: string;
  challengeType: AcmeChallengeType;
  cloudflareToken: string;
}

export const SETTING_KEYS = [
  "autoRenew",
  "domain",
  "email",
  "provider",
  "directoryUrl",
  "challengeType",
  "cloudflareToken",
] as const;

export const DIRECTORIES: Record<Exclude<AcmeProvider, "custom">, string> = {
  letsencrypt: "https://acme-v02.api.letsencrypt.org/directory",
  "letsencrypt-staging":
    "https://acme-staging-v02.api.letsencrypt.org/directory",
};

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export async function readSettings(ctx: PluginContext): Promise<AcmeSettings> {
  const all = await ctx.settings.getAll("admin");
  const provider = text(all.provider);
  const challengeType = text(all.challengeType);
  return {
    autoRenew: all.autoRenew === true,
    domain: text(all.domain).toLowerCase(),
    email: text(all.email),
    provider:
      provider === "letsencrypt-staging" || provider === "custom"
        ? provider
        : "letsencrypt",
    directoryUrl: text(all.directoryUrl),
    challengeType:
      challengeType === "dns-cloudflare" ? challengeType : "http-01",
    cloudflareToken: text(all.cloudflareToken),
  };
}

export function directoryUrlFor(settings: AcmeSettings): string {
  return settings.provider === "custom"
    ? settings.directoryUrl
    : DIRECTORIES[settings.provider];
}

/** The reason issuing cannot start, or null when everything is set. */
export function missingSetting(settings: AcmeSettings): string | null {
  if (!settings.domain) return "domain";
  if (!settings.email) return "email";
  if (
    settings.provider === "custom" &&
    !/^https:\/\//i.test(settings.directoryUrl)
  ) {
    return "directoryUrl";
  }
  if (
    settings.challengeType === "dns-cloudflare" &&
    !settings.cloudflareToken
  ) {
    return "cloudflareToken";
  }
  return null;
}
