/**
 * Sign in for the Termix mobile app in a real browser. The app opens the
 * login page with ?return_to=termix-mobile://..., and after any login method
 * the page sends the result back to that address. Only the app's own scheme
 * is accepted, so the value can never send a token to a website. Newer apps
 * also pass app_challenge: login requests then carry it and the server
 * answers with a one-time code that only the app can redeem.
 */

const STORAGE_KEY = "termix-app-return";
const PARAM = "return_to";
const APP_RETURN = /^termix-mobile:\/\/[A-Za-z0-9._~/-]*$/;
const CHALLENGE_KEY = "termix-app-challenge";
const CHALLENGE_PARAM = "app_challenge";
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const APP_CHALLENGE_HEADER = "X-Termix-App-Challenge";

export function isAppReturn(value: unknown): value is string {
  return typeof value === "string" && APP_RETURN.test(value);
}

/** Reads return_to from the address bar once and keeps it for this tab. */
export function captureAppReturn(): string | null {
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(PARAM);
    if (value !== null) {
      const challenge = url.searchParams.get(CHALLENGE_PARAM);
      url.searchParams.delete(PARAM);
      url.searchParams.delete(CHALLENGE_PARAM);
      window.history.replaceState({}, document.title, url.toString());
      if (isAppReturn(value)) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
      if (isAppReturn(value) && challenge && CHALLENGE.test(challenge)) {
        sessionStorage.setItem(CHALLENGE_KEY, challenge);
      } else {
        sessionStorage.removeItem(CHALLENGE_KEY);
      }
    }
    return pendingAppReturn();
  } catch {
    return null;
  }
}

export function pendingAppReturn(): string | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return isAppReturn(value) ? value : null;
  } catch {
    return null;
  }
}

/** The app's challenge for this sign in, sent with login requests. */
export function pendingAppChallenge(): string | null {
  if (!pendingAppReturn()) return null;
  try {
    const value = sessionStorage.getItem(CHALLENGE_KEY);
    return value && CHALLENGE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function appReturnUrl(
  base: string,
  params: Record<string, string>,
): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}

/** Sends the result to the app. False when no app asked for it. */
export function handOffToApp(params: Record<string, string>): boolean {
  const base = pendingAppReturn();
  if (!base) return false;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(CHALLENGE_KEY);
  } catch {
    // The redirect still goes out.
  }
  window.location.replace(appReturnUrl(base, params));
  return true;
}
