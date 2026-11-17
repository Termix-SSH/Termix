import { describe, expect, it } from "vitest";
import {
  markFrameLoading,
  markFrameShown,
  whenFrameShown,
} from "@/plugin-frame/frame-paint";

function root() {
  return document.createElement("html");
}

describe("frame paint", () => {
  it("shows the spinner only for full views", () => {
    const full = root();
    markFrameLoading("#role=view&key=main&fit=fill", full);
    expect(full.dataset.frameLoading).toBe("1");

    for (const hash of [
      "#role=background",
      "#role=view&fit=content",
      "#role=view&fit=content&inline=1",
      "#role=view&fit=content&bar=1",
      "#role=view&fit=fill&bg=none&drawn=1",
      "#role=view&key=main&fit=fill&spin=host",
    ]) {
      const other = root();
      markFrameLoading(hash, other);
      expect(other.dataset.frameLoading, hash).toBeUndefined();
    }
  });

  it("drops the spinner once the view renders", () => {
    const element = root();
    markFrameLoading("role=view&fit=fill", element);
    markFrameShown(element);
    expect(element.dataset.frameLoading).toBeUndefined();
    expect(element.dataset.frameShown).toBe("1");
  });

  it("says when the view first rendered", async () => {
    markFrameShown(root());
    await expect(whenFrameShown()).resolves.toBeUndefined();
  });
});
