import { describe, expect, it } from "vitest";
import { quoteTerminalImagePath } from "@/features/terminal/terminal-image-path";

describe("quoteTerminalImagePath", () => {
  it("preserves spaces as one shell argument", () => {
    expect(quoteTerminalImagePath("/mnt/my images/clipboard.png")).toBe(
      "'/mnt/my images/clipboard.png'",
    );
  });

  it("does not expose shell metacharacters as syntax", () => {
    expect(
      quoteTerminalImagePath("/tmp/$(touch /tmp/pwned);`id`; 'quoted'.png"),
    ).toBe("'/tmp/$(touch /tmp/pwned);`id`; '\\''quoted'\\''.png'");
  });

  it("quotes an empty path instead of returning executable input", () => {
    expect(quoteTerminalImagePath("")).toBe("''");
  });
});
