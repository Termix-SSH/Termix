const CALLBACK_PATH = "/oidc-callback";

/**
 * Whether a redirect login's return address is the desktop app's loopback
 * listener or the mobile app's scheme, which get the token in the URL
 * because they cannot read a cookie.
 */
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
