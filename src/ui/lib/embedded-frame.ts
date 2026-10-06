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

export function isInElectronWebView(): boolean {
  if (isInMobileWebView()) return false;
  if ((window as EmbeddedFrameWindow).IS_ELECTRON_WEBVIEW) return true;
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
