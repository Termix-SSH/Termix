import { describe, expect, it } from "vitest";
import { clampGuacamoleZoom, stepGuacamoleZoom } from "./guacamole-zoom.js";

describe("guacamole zoom", () => {
  it("steps in predictable quarter increments", () => {
    expect(stepGuacamoleZoom(1, 1)).toBe(1.25);
    expect(stepGuacamoleZoom(1, -1)).toBe(0.75);
  });

  it("keeps toolbar and pinch zoom within usable bounds", () => {
    expect(clampGuacamoleZoom(0.1)).toBe(0.5);
    expect(clampGuacamoleZoom(8)).toBe(4);
  });
});
