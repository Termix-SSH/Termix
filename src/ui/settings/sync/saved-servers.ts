// Same key as 2.8, so a desktop keeps the servers it already used.
const SAVED_URLS_KEY = "termix_saved_server_urls";
const MAX_SAVED_URLS = 5;

export function getSavedServerUrls(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_URLS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((url): url is string => typeof url === "string")
      : [];
  } catch {
    return [];
  }
}

function write(urls: string[]): void {
  try {
    localStorage.setItem(SAVED_URLS_KEY, JSON.stringify(urls));
  } catch {
    // Storage can be unavailable.
  }
}

export function rememberServerUrl(url: string): string[] {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return getSavedServerUrls();
  const urls = [
    trimmed,
    ...getSavedServerUrls().filter((saved) => saved !== trimmed),
  ].slice(0, MAX_SAVED_URLS);
  write(urls);
  return urls;
}

export function forgetServerUrl(url: string): string[] {
  const urls = getSavedServerUrls().filter((saved) => saved !== url);
  write(urls);
  return urls;
}
