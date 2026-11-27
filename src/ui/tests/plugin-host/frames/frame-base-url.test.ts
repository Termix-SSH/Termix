import { describe, it, expect, afterEach } from "vitest";
import {
  frameBaseUrl,
  frameUrl,
} from "../../../plugin-host/frames/frame-connection.js";

const originalLocation = window.location;
const win = window as unknown as Record<string, unknown>;

/** A page URL, as the browser would report it. */
function setPageUrl(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
  });
}

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  delete win.__TERMIX_BASE_PATH__;
});

describe("frameBaseUrl", () => {
  it("points at the server root when the page has no query", () => {
    setPageUrl("https://termix.example/");
    expect(frameBaseUrl()).toBe("https://termix.example");
  });

  it("does not inherit the query of the page", () => {
    // After a redirect login the app lands on /?success=true.
    setPageUrl("https://termix.example/?success=true");
    expect(frameBaseUrl()).toBe("https://termix.example");
  });

  it("does not inherit a route of the page", () => {
    setPageUrl("https://termix.example/sessions?tab=1");
    expect(frameBaseUrl()).toBe("https://termix.example");
  });

  it("keeps a configured base path", () => {
    win.__TERMIX_BASE_PATH__ = "/termix";
    setPageUrl("https://termix.example/termix/?success=true");
    expect(frameBaseUrl()).toBe("https://termix.example/termix");
  });
});

describe("frameUrl", () => {
  it("builds the frame URL on the server root, not on the page URL", () => {
    setPageUrl("https://termix.example/?success=true");
    expect(frameUrl("alerts", { role: "view" })).toBe(
      "https://termix.example/plugin-assets/alerts/_frame/frame.html#role=view",
    );
  });
});
