import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appReturnUrl,
  captureAppReturn,
  handOffToApp,
  isAppReturn,
  pendingAppReturn,
} from "@/lib/app-return";

function visit(path: string) {
  window.history.replaceState({}, "", path);
}

beforeEach(() => {
  sessionStorage.clear();
  visit("/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isAppReturn", () => {
  it("accepts only the mobile app scheme", () => {
    expect(isAppReturn("termix-mobile://oidc-callback")).toBe(true);
    expect(isAppReturn("https://evil.example/cb")).toBe(false);
    expect(isAppReturn("http://localhost/oidc-callback")).toBe(false);
    expect(isAppReturn("javascript:alert(1)")).toBe(false);
    expect(isAppReturn("termix-mobile-evil://x")).toBe(false);
    expect(isAppReturn("termix-mobile://cb?next=https://evil")).toBe(false);
    expect(isAppReturn("termix-mobile://cb#x")).toBe(false);
    expect(isAppReturn(null)).toBe(false);
  });
});

describe("captureAppReturn", () => {
  it("keeps a valid return address and removes it from the address bar", () => {
    visit("/?return_to=termix-mobile%3A%2F%2Foidc-callback&x=1");
    expect(captureAppReturn()).toBe("termix-mobile://oidc-callback");
    expect(window.location.search).toBe("?x=1");
    expect(pendingAppReturn()).toBe("termix-mobile://oidc-callback");
  });

  it("drops anything else", () => {
    sessionStorage.setItem("termix-app-return", "termix-mobile://old");
    visit("/?return_to=https%3A%2F%2Fevil.example");
    expect(captureAppReturn()).toBeNull();
    expect(pendingAppReturn()).toBeNull();
  });

  it("keeps a stored value across a redirect back with no param", () => {
    sessionStorage.setItem(
      "termix-app-return",
      "termix-mobile://oidc-callback",
    );
    visit("/?success=true");
    expect(captureAppReturn()).toBe("termix-mobile://oidc-callback");
  });

  it("ignores a stored value that was tampered with", () => {
    sessionStorage.setItem("termix-app-return", "https://evil.example");
    expect(pendingAppReturn()).toBeNull();
  });
});

describe("handOffToApp", () => {
  it("does nothing when no app asked", () => {
    expect(handOffToApp({ token: "t" })).toBe(false);
  });

  it("builds the return address with the token", () => {
    expect(
      appReturnUrl("termix-mobile://oidc-callback", { token: "a b" }),
    ).toBe("termix-mobile://oidc-callback?token=a+b");
  });

  it("redirects once and forgets the address", () => {
    sessionStorage.setItem(
      "termix-app-return",
      "termix-mobile://oidc-callback",
    );
    const replace = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      replace,
    } as Location);
    expect(handOffToApp({ token: "t1" })).toBe(true);
    expect(replace).toHaveBeenCalledWith(
      "termix-mobile://oidc-callback?token=t1",
    );
    expect(pendingAppReturn()).toBeNull();
  });
});
