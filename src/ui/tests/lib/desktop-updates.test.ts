import { describe, expect, it } from "vitest";
import { updateToastFor, type DesktopUpdateState } from "@/lib/desktop-updates";

function state(patch: Partial<DesktopUpdateState>): DesktopUpdateState {
  return {
    kind: "auto",
    mode: "prompt",
    currentVersion: "26.10.1",
    status: "available",
    version: "26.10.2",
    releaseUrl: null,
    progress: null,
    error: null,
    ...patch,
  };
}

describe("updateToastFor", () => {
  it("asks before downloading in ask first mode", () => {
    expect(updateToastFor(state({}))).toBe("prompt");
  });

  it("stays quiet while automatic mode downloads", () => {
    expect(updateToastFor(state({ mode: "automatic" }))).toBeNull();
    expect(
      updateToastFor(state({ mode: "automatic", status: "downloading" })),
    ).toBeNull();
  });

  it("offers a restart once downloaded", () => {
    expect(updateToastFor(state({ status: "downloaded" }))).toBe("ready");
    expect(
      updateToastFor(state({ mode: "automatic", status: "downloaded" })),
    ).toBe("ready");
  });

  it("links the release for installs that can not update", () => {
    expect(updateToastFor(state({ kind: "manual" }))).toBe("manual");
  });

  it("never toasts when updates are off", () => {
    expect(updateToastFor(state({ mode: "never" }))).toBeNull();
    expect(
      updateToastFor(state({ mode: "never", status: "downloaded" })),
    ).toBeNull();
    expect(updateToastFor(null)).toBeNull();
  });
});
