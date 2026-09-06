import { describe, expect, it } from "vitest";
import {
  captureDefaultIconHrefs,
  nextIconHref,
} from "../../contexts/branding-document.js";

const ICON = 'link[rel="icon"]';

describe("branding document icons", () => {
  it("keeps bundled hrefs so a logo reset can restore them", () => {
    const stored: Record<string, string> = {};
    const hrefs: Record<string, string> = {
      [ICON]: "https://app.example/favicon.ico",
      'link[rel="apple-touch-icon"]': "https://app.example/icons/512x512.png",
    };

    captureDefaultIconHrefs(stored, (selector) => ({ href: hrefs[selector] }));
    expect(
      nextIconHref("data:image/png;base64,abc", stored[ICON], hrefs[ICON]),
    ).toBe("data:image/png;base64,abc");

    hrefs[ICON] = "data:image/png;base64,abc";
    captureDefaultIconHrefs(stored, (selector) => ({ href: hrefs[selector] }));
    expect(nextIconHref(null, stored[ICON], hrefs[ICON])).toBe(
      "https://app.example/favicon.ico",
    );
  });
});
