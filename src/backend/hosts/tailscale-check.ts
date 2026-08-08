// Tailscale SSH "check mode" sends its re-authentication prompt as an SSH auth
// banner during the "none" auth method, then long-polls its control plane while
// the connection stays open. The banner text itself comes from the control plane
// (it is not in the tailscaled source), so match on the login URL rather than the
// surrounding wording, which can change without notice.

const TAILSCALE_CHECK_URL = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/;

const CHECK_COMPLETE = /authentication checked/i;

export interface TailscaleCheckBanner {
  url: string;
  message: string;
}

function stripCommentMarkers(banner: string): string {
  return banner
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export function parseTailscaleCheckBanner(
  banner: string,
): TailscaleCheckBanner | null {
  if (!banner) return null;

  const match = banner.match(TAILSCALE_CHECK_URL);
  if (!match) return null;

  return {
    url: match[0],
    message: stripCommentMarkers(banner),
  };
}

export function isTailscaleCheckCompleteBanner(banner: string): boolean {
  if (!banner) return false;
  return CHECK_COMPLETE.test(banner);
}
