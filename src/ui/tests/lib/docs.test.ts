import { describe, expect, it } from "vitest";
import { DOCS_PAGES, DOCS_URL, docsUrl } from "@/lib/docs";

describe("docsUrl", () => {
  it("builds full links to core docs pages", () => {
    expect(docsUrl()).toBe(`${DOCS_URL}/`);
    expect(docsUrl("hosts")).toBe(`${DOCS_URL}/guide/hosts`);
    expect(docsUrl("portKnocking")).toBe(
      `${DOCS_URL}/guide/hosts#port-knocking`,
    );
  });

  it("keeps every page a relative path", () => {
    for (const path of Object.values(DOCS_PAGES)) {
      expect(path).not.toMatch(/^\/|^https?:/);
    }
  });
});
