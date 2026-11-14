import { afterEach, describe, expect, it } from "vitest";
import {
  resolveSlotFit,
  slotFit,
  splitFallback,
} from "@/plugin-host/frames/slot-fit";
import {
  declareActionSlot,
  resetActionRegistry,
} from "@/shell/action-registry";

afterEach(() => resetActionRegistry());

describe("resolveSlotFit", () => {
  it("guesses row items and badges as inline", () => {
    expect(slotFit("dashboard.hostRow")).toBe("inline");
    expect(slotFit("dashboard.hostRowBadge")).toBe("inline");
  });

  it("lets the slot's owner decide over the guess", () => {
    expect(resolveSlotFit("hosts.panel")).toBe("content");
    declareActionSlot({
      id: "hosts.panel",
      accepts: ["component"],
      fit: "fill",
    });
    expect(resolveSlotFit("hosts.panel")).toBe("fill");
  });

  it("falls back to the guess when the owner names no fit", () => {
    declareActionSlot({ id: "tab.inline", accepts: ["component"] });
    expect(resolveSlotFit("tab.inline")).toBe("inline");
  });
});

describe("splitFallback", () => {
  it("keeps an element out of the frame's props", () => {
    const fallback = <span>Offline</span>;
    const { fallback: kept, rest } = splitFallback({ hostId: 1, fallback });
    expect(kept).toBe(fallback);
    expect(rest).toEqual({ hostId: 1 });
  });

  it("leaves a plain fallback value alone", () => {
    const props = { fallback: "text" };
    expect(splitFallback(props)).toEqual({ fallback: undefined, rest: props });
  });
});
