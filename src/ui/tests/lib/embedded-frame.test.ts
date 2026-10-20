import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmbeddedAuthFrame,
  isInElectronWebView,
  isInMobileWebView,
} from "@/lib/embedded-frame";

type TestWindow = Window & {
  ReactNativeWebView?: unknown;
  IS_ELECTRON_WEBVIEW?: boolean;
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as TestWindow).ReactNativeWebView;
  delete (window as TestWindow).IS_ELECTRON_WEBVIEW;
});

describe("embedded frame detection", () => {
  it("is false for a normal browser tab", () => {
    expect(isInMobileWebView()).toBe(false);
    expect(isInElectronWebView()).toBe(false);
    expect(isEmbeddedAuthFrame()).toBe(false);
  });

  it("spots the mobile app by user agent or bridge", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 Termix-Mobile/Android",
    );
    expect(isInMobileWebView()).toBe(true);
    vi.restoreAllMocks();
    (window as TestWindow).ReactNativeWebView = { postMessage() {} };
    expect(isInMobileWebView()).toBe(true);
    expect(isInElectronWebView()).toBe(false);
    expect(isEmbeddedAuthFrame()).toBe(true);
  });

  it("spots the desktop link window by flag", () => {
    (window as TestWindow).IS_ELECTRON_WEBVIEW = true;
    expect(isInElectronWebView()).toBe(true);
    expect(isEmbeddedAuthFrame()).toBe(true);
  });

  it("only treats a frame as the desktop link window inside the app", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    expect(isInElectronWebView()).toBe(false);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Termix-Desktop/26.10.2 (win32; Electron/38.0.0)",
    );
    expect(isInElectronWebView()).toBe(true);
  });

  it("spots the desktop link window by Electron's default user agent", () => {
    // What a cross-origin frame inside the desktop app reports (#1675).
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) termix/26.10.2 Chrome/150.0.7871.250 Electron/43.7.7 Safari/537.36",
    );
    expect(isInElectronWebView()).toBe(true);
  });

  it("does not trust another Electron app or a plain browser frame", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const ua = vi.spyOn(navigator, "userAgent", "get");
    ua.mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36",
    );
    expect(isInElectronWebView()).toBe(false);
    ua.mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) other-app/1.0.0 Chrome/150.0 Electron/43.7.7 Safari/537.36",
    );
    expect(isInElectronWebView()).toBe(false);
  });
});
