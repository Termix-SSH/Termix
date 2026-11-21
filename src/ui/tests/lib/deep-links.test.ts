import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostIdOf,
  onDeepLink,
  resetDeepLinks,
  startDeepLinks,
} from "@/lib/deep-links";

afterEach(() => {
  resetDeepLinks();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe("deep links", () => {
  it("replays earlier links and passes on new ones", async () => {
    let push: (link: unknown) => void = () => {};
    (window as { electronAPI?: unknown }).electronAPI = {
      onDeepLink: async (callback: (link: unknown) => void) => {
        push = callback;
        return [{ url: "termix://host/3", source: "command-line" }];
      },
    };
    startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    const seen = vi.fn();
    const stop = onDeepLink(seen);
    expect(seen).toHaveBeenCalledWith({
      url: "termix://host/3",
      source: "command-line",
    });
    push({ url: "termix://x", source: "anything" });
    expect(seen).toHaveBeenLastCalledWith({
      url: "termix://x",
      source: "os-scheme",
    });
    stop();
    push({ url: "termix://y" });
    expect(seen).toHaveBeenCalledTimes(2);
    push({ url: "https://evil" });
  });

  it("reads a host id from termix://host/<id>", () => {
    expect(hostIdOf("termix://host/12")).toBe(12);
    expect(hostIdOf("termix://host/0")).toBeNull();
    expect(hostIdOf("termix://host/12/x")).toBeNull();
    expect(hostIdOf("termix://connect?host=12")).toBeNull();
    expect(hostIdOf("nope")).toBeNull();
  });
});
