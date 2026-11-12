import { describe, expect, it } from "vitest";
import { attachmentHeader } from "../../http/content-disposition.js";

describe("attachmentHeader", () => {
  it("keeps a plain name", () => {
    expect(attachmentHeader("termix-user-bob-export.json")).toBe(
      `attachment; filename="termix-user-bob-export.json"; filename*=UTF-8''termix-user-bob-export.json`,
    );
  });

  it("can't be broken out of with quotes, slashes or line breaks", () => {
    const header = attachmentHeader('a"; evil=1\r\nX-Injected: y/../b.json');
    expect(header).not.toMatch(/[\r\n]/);
    const plain = /filename="([^"]*)"/.exec(header)![1];
    expect(plain).not.toContain("/");
    expect(plain).not.toContain('"');
    expect(header.match(/"/g)).toHaveLength(2);
  });

  it("carries non ASCII names encoded", () => {
    const header = attachmentHeader("jörg.json");
    expect(header).toContain(`filename="j_rg.json"`);
    expect(header).toContain("filename*=UTF-8''j%C3%B6rg.json");
  });
});
