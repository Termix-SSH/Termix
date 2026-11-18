import { afterEach, describe, expect, it } from "vitest";
import {
  liveWork,
  noteLiveWork,
  resetLiveTracking,
  startLiveTracking,
  stopLiveTracking,
} from "@/plugin-frame/frame-liveness";

afterEach(() => resetLiveTracking());

describe("frame live work", () => {
  it("counts a timer activate started and left running", () => {
    startLiveTracking();
    const id = setInterval(() => {}, 1000);
    stopLiveTracking();
    expect(liveWork()).toEqual(["timer"]);
    clearInterval(id);
    expect(liveWork()).toEqual([]);
  });

  it("ignores timers started after activate", () => {
    startLiveTracking();
    stopLiveTracking();
    const id = setInterval(() => {}, 1000);
    expect(liveWork()).toEqual([]);
    clearInterval(id);
  });

  it("counts shell subscriptions whenever they happen", () => {
    noteLiveWork("tabs.onChange");
    noteLiveWork("tabs.onChange");
    expect(liveWork()).toEqual(["tabs.onChange"]);
  });

  it("counts a timer an overlay starts while its mount is tracked again", async () => {
    const { createElement, useEffect } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    startLiveTracking();
    stopLiveTracking();
    const later = setInterval(() => {}, 1000);
    function Overlay() {
      useEffect(() => {
        const id = setInterval(() => {}, 1000);
        return () => clearInterval(id);
      }, []);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    startLiveTracking();
    flushSync(() => root.render(createElement(Overlay)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopLiveTracking();
    expect(liveWork()).toEqual(["timer"]);
    root.unmount();
    expect(liveWork()).toEqual([]);
    clearInterval(later);
  });
});
