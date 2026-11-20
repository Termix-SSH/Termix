import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseLink, linksFromArgv, createLinkQueue } =
  require("../../../../electron/deep-link.cjs") as typeof import("../../../../electron/deep-link.cjs");

describe("desktop deep links", () => {
  it("takes only sane termix:// links", () => {
    expect(parseLink("termix://connect?host=web-1")).toBe(
      "termix://connect?host=web-1",
    );
    expect(parseLink("https://example.com")).toBeNull();
    expect(parseLink("termix://a\u0007b")).toBeNull();
    expect(parseLink("termix://user:pw@host/x")).toBeNull();
    expect(parseLink(`termix://${"a".repeat(3000)}`)).toBeNull();
    expect(parseLink(42)).toBeNull();
  });

  it("reads links and --host from a command line", () => {
    expect(
      linksFromArgv([
        "C:/Termix/Termix.exe",
        "--host=12",
        "--host=abc",
        "termix://connect?type=rdp",
      ]),
    ).toEqual([
      { url: "termix://host/12", source: "command-line" },
      { url: "termix://connect?type=rdp", source: "os-scheme" },
    ]);
  });

  it("holds links until the window listens", () => {
    const queue = createLinkQueue();
    queue.push({ url: "termix://a", source: "os-scheme" });
    expect(queue.take()).toEqual([{ url: "termix://a", source: "os-scheme" }]);
    const send = vi.fn();
    queue.attach(send);
    queue.push({ url: "termix://b", source: "os-scheme" });
    expect(send).toHaveBeenCalledWith({
      url: "termix://b",
      source: "os-scheme",
    });
    expect(queue.take()).toEqual([]);
  });
});
