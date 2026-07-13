const CALLBACK_PATH = "/oidc-callback";

export function getDesktopOidcCallbackUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return `http://localhost:${port}${CALLBACK_PATH}`;
}

export function isOidcTokenCallback(value: string): boolean {
  if (value.startsWith("termix-mobile:")) return true;

  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === CALLBACK_PATH
    );
  } catch {
    return false;
  }
}
