import type { PluginTlsStatus } from "@termix/plugin-sdk/backend";

export const RENEW_BEFORE_MS = 30 * 86_400_000;

export type RenewalReason = "missing" | "self-signed" | "domain" | "expiring";

/**
 * Whether the served certificate should be replaced for `domain`: there is
 * none, it is core's self-signed one, it does not cover the domain, or it
 * expires within 30 days.
 */
export function renewalReason(
  status: PluginTlsStatus,
  domain: string,
  now: Date = new Date(),
): RenewalReason | null {
  const cert = status.certificate;
  if (!cert) return "missing";
  if (cert.selfSigned) return "self-signed";
  const wanted = domain.toLowerCase();
  if (!cert.names.some((name) => name.toLowerCase() === wanted)) {
    return "domain";
  }
  if (new Date(cert.notAfter).getTime() - now.getTime() < RENEW_BEFORE_MS) {
    return "expiring";
  }
  return null;
}
