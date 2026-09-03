export const BRANDING_ICON_SELECTORS = [
  'link[rel="icon"]',
  'link[rel="apple-touch-icon"]',
] as const;

/**
 * Snapshot bundled favicon hrefs before the first custom logo is written.
 * Reset then restores those snapshots instead of leaving the previous upload
 * in the tab until a full reload.
 */
export function captureDefaultIconHrefs(
  stored: Record<string, string>,
  query: (selector: string) => { href: string } | null,
): void {
  for (const selector of BRANDING_ICON_SELECTORS) {
    if (stored[selector]) continue;
    const link = query(selector);
    if (link?.href) stored[selector] = link.href;
  }
}

export function nextIconHref(
  customLogo: string | null,
  defaultHref: string | undefined,
  currentHref: string,
): string {
  if (customLogo) return customLogo;
  return defaultHref ?? currentHref;
}
