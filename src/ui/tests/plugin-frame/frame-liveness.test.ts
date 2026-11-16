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
});
