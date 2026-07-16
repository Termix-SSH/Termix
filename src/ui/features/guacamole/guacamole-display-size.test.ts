import { describe, expect, it } from "vitest";
import { getGuacamoleDisplaySize } from "./guacamole-display-size";

describe("getGuacamoleDisplaySize", () => {
  it("requests native pixels and matching DPI for HiDPI RDP", () => {
    expect(getGuacamoleDisplaySize(1280, 720, "rdp", 2)).toEqual({
      width: 2560,
      height: 1440,
      dpi: 192,
      pixelRatio: 2,
    });
  });

  it("scales a configured RDP DPI with the device pixel ratio", () => {
    expect(getGuacamoleDisplaySize(1000, 600, "rdp", 1.5, 120)).toEqual({
      width: 1500,
      height: 900,
      dpi: 180,
      pixelRatio: 1.5,
    });
  });

  it("leaves non-RDP protocols at CSS-pixel dimensions", () => {
    expect(getGuacamoleDisplaySize(1280, 720, "vnc", 2)).toEqual({
      width: 1280,
      height: 720,
      pixelRatio: 1,
    });
  });

  it("caps pathological pixel ratios to protect remote session size", () => {
    expect(getGuacamoleDisplaySize(400, 800, "rdp", 4)).toEqual({
      width: 1200,
      height: 2400,
      dpi: 288,
      pixelRatio: 3,
    });
  });
});
