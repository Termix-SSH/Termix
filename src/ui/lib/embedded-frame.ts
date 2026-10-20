/**
 * The two places this web UI runs only to sign someone in for another app:
 * the Termix mobile app's WebView, and the iframe a desktop app shows a
 * server's login in while linking. Neither should ever show onboarding.
 */

export interface EmbeddedFrameWindow extends Window {
  IS_ELECTRON_WEBVIEW?: boolean;
  ReactNativeWebView?: { postMessage: (msg: string) => void };
}

export function isInMobileWebView(): boolean {
  return (
    /Termix-Mobile\/(Android|iOS)/.test(navigator.userAgent) ||
    !!(window as EmbeddedFrameWindow).ReactNativeWebView
  );
}

// The desktop app's own user agent. The link window frames the server
// cross-origin, and Electron does not carry webContents.setUserAgent into
// such a frame, so there navigator.userAgent is Electron's default, which
// still names the app: "... termix/26.10.2 Chrome/... Electron/43.7.7 ...".
const DESKTOP_USER_AGENT = /Termix-Desktop\/|\btermix\/[\w.-]+ .*\bElectron\//i;

// Being framed alone is not enough: any site could frame this page and
// receive the token posted to window.parent. The desktop app's user agent,
// in either form above, is something a web page cannot fake in someone
// else's browser.
export function isInElectronWebView(): boolean {
  if (isInMobileWebView()) return false;
  if ((window as EmbeddedFrameWindow).IS_ELECTRON_WEBVIEW) return true;
  if (!DESKTOP_USER_AGENT.test(navigator.userAgent)) return false;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  return false;
}

export function isEmbeddedAuthFrame(): boolean {
  return isInMobileWebView() || isInElectronWebView();
}
