import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const api = vi.hoisted(() => ({
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
  saveUserPreferences: vi.fn(async () => ({})),
}));

vi.mock("@/api/open-tabs-api", () => api);

import {
  readRailPreference,
  setRailPreference,
} from "../../sidebar/rail-preferences";

describe("rail-preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    api.getUserPreferences.mockReset();
    api.getUserPreferences.mockResolvedValue({ storageMode: "local" });
    api.saveUserPreferences.mockReset();
    api.saveUserPreferences.mockResolvedValue({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("readRailPreference", () => {
    it("defaults pinAppRail to false when unset", () => {
      expect(readRailPreference("pinAppRail")).toBe(false);
    });

    it("defaults expandAppRailOnHover to true when unset", () => {
      expect(readRailPreference("expandAppRailOnHover")).toBe(true);
    });

    it("reads stored values back for both keys", () => {
      localStorage.setItem("pinAppRail", "true");
      localStorage.setItem("expandAppRailOnHover", "false");
      expect(readRailPreference("pinAppRail")).toBe(true);
      expect(readRailPreference("expandAppRailOnHover")).toBe(false);
    });
  });

  describe("setRailPreference", () => {
    it("persists the value to localStorage", () => {
      setRailPreference("pinAppRail", true);
      expect(localStorage.getItem("pinAppRail")).toBe("true");

      setRailPreference("expandAppRailOnHover", false);
      expect(localStorage.getItem("expandAppRailOnHover")).toBe("false");
    });

    it("dispatches the matching change event so other surfaces resync", () => {
      const pinListener = vi.fn();
      const hoverListener = vi.fn();
      window.addEventListener("pinAppRailChanged", pinListener);
      window.addEventListener("expandAppRailOnHoverChanged", hoverListener);

      setRailPreference("pinAppRail", true);
      expect(pinListener).toHaveBeenCalledTimes(1);
      expect(hoverListener).not.toHaveBeenCalled();

      setRailPreference("expandAppRailOnHover", false);
      expect(hoverListener).toHaveBeenCalledTimes(1);

      window.removeEventListener("pinAppRailChanged", pinListener);
      window.removeEventListener("expandAppRailOnHoverChanged", hoverListener);
    });

    it("round-trips through read after a write", () => {
      setRailPreference("pinAppRail", true);
      expect(readRailPreference("pinAppRail")).toBe(true);

      setRailPreference("pinAppRail", false);
      expect(readRailPreference("pinAppRail")).toBe(false);
    });

    it("mirrors to the server when storage mode is cloud", async () => {
      api.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });

      setRailPreference("pinAppRail", true);
      await vi.waitFor(() =>
        expect(api.saveUserPreferences).toHaveBeenCalledWith({
          pinAppRail: true,
        }),
      );
    });

    it("does not hit the server when storage mode is local", async () => {
      setRailPreference("pinAppRail", true);
      await vi.waitFor(() => expect(api.getUserPreferences).toHaveBeenCalled());
      expect(api.saveUserPreferences).not.toHaveBeenCalled();
    });

    it("still persists locally when the preference lookup fails", async () => {
      api.getUserPreferences.mockRejectedValue(new Error("offline"));

      expect(() => setRailPreference("pinAppRail", true)).not.toThrow();
      expect(localStorage.getItem("pinAppRail")).toBe("true");
      await vi.waitFor(() => expect(api.getUserPreferences).toHaveBeenCalled());
    });
  });
});
