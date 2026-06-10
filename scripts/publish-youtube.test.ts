import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { extractYoutubeId, parseYoutubeId } = require("./publish-youtube.cjs");

describe("parseYoutubeId", () => {
  it("parses a youtu.be short link", () => {
    expect(parseYoutubeId("https://youtu.be/At8iDk6-Q_s")).toBe("At8iDk6-Q_s");
  });

  it("parses a watch?v= link", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=At8iDk6-Q_s")).toBe(
      "At8iDk6-Q_s",
    );
  });

  it("parses an embed link", () => {
    expect(parseYoutubeId("https://www.youtube.com/embed/At8iDk6-Q_s")).toBe(
      "At8iDk6-Q_s",
    );
  });

  it("accepts a bare id", () => {
    expect(parseYoutubeId("At8iDk6-Q_s")).toBe("At8iDk6-Q_s");
  });

  it("throws on garbage", () => {
    expect(() => parseYoutubeId("https://example.com/")).toThrow();
  });
});

describe("extractYoutubeId", () => {
  it("pulls the id from a release notes YOUTUBE section", () => {
    const notes = [
      "<!-- SUMMARY -->",
      "stuff",
      "<!-- /SUMMARY -->",
      "<!-- YOUTUBE -->",
      "https://youtu.be/At8iDk6-Q_s",
      "<!-- /YOUTUBE -->",
    ].join("\n");
    expect(extractYoutubeId(notes)).toBe("At8iDk6-Q_s");
  });

  it("throws when the YOUTUBE section is missing", () => {
    expect(() => extractYoutubeId("no section here")).toThrow(/YOUTUBE/);
  });

  it("throws when the YOUTUBE section is empty", () => {
    expect(() =>
      extractYoutubeId("<!-- YOUTUBE -->\n\n<!-- /YOUTUBE -->"),
    ).toThrow(/empty/);
  });
});
