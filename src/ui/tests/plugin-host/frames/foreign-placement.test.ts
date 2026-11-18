import { describe, expect, it } from "vitest";
import {
  intersect,
  placeView,
  readRect,
  visibleBox,
  type PlaceInput,
} from "@/plugin-host/frames/foreign-placement";

const base: PlaceInput = {
  frame: { x: 100, y: 50, width: 800, height: 600 },
  box: { x: 100, y: 50, width: 800, height: 600 },
  frameShown: true,
  placement: {
    rect: { x: 20, y: 30, width: 200, height: 100 },
    clip: null,
    visible: true,
  },
  occluders: [],
  drawn: true,
};

describe("foreign view placement", () => {
  it("moves the placeholder rect from frame to layer coordinates", () => {
    const out = placeView(base);
    expect(out).toMatchObject({
      hidden: false,
      left: 20,
      top: 30,
      width: 200,
      height: 100,
      clipPath: "",
    });
  });

  it("offsets by the part of the frame the page cuts away", () => {
    // The shell scrolled the frame up by 40 px under a header.
    const out = placeView({
      ...base,
      box: { x: 100, y: 90, width: 800, height: 560 },
    });
    expect(out.top).toBe(-10);
    expect(out.clipPath).toBe("inset(10px 0px 0px 0px)");
    expect(out.hidden).toBe(false);
  });

  it("clips to what the consumer's own scroll box shows", () => {
    const out = placeView({
      ...base,
      placement: {
        ...base.placement,
        clip: { x: 0, y: 60, width: 800, height: 500 },
      },
    });
    expect(out.clipPath).toBe("inset(30px 0px 0px 0px)");
  });

  it("keeps a placeholder moved over the shell inside the consumer box", () => {
    // A consumer claims a spot above and left of itself, over the shell's
    // tab bar. Nothing outside the frame shows.
    const out = placeView({
      ...base,
      placement: {
        rect: { x: -100, y: -50, width: 90, height: 40 },
        clip: null,
        visible: true,
      },
    });
    expect(out.hidden).toBe(true);
    expect(out.clipPath).toBe("inset(100%)");
    // Half over the edge: only the part inside the frame shows.
    const half = placeView({
      ...base,
      placement: {
        rect: { x: -50, y: 10, width: 100, height: 40 },
        clip: null,
        visible: true,
      },
    });
    expect(half.hidden).toBe(false);
    expect(half.clipPath).toBe("inset(0px 0px 0px 50px)");
  });

  it("hides while the placeholder is hidden or scrolled out", () => {
    expect(
      placeView({
        ...base,
        placement: { ...base.placement, visible: false },
      }).hidden,
    ).toBe(true);
    expect(
      placeView({
        ...base,
        placement: {
          ...base.placement,
          clip: { x: 0, y: 500, width: 10, height: 10 },
        },
      }).hidden,
    ).toBe(true);
  });

  it("hides while the consumer frame is not shown (tab in the back)", () => {
    expect(placeView({ ...base, frameShown: false }).hidden).toBe(true);
    expect(
      placeView({ ...base, box: { x: 0, y: 0, width: 0, height: 0 } }).hidden,
    ).toBe(true);
  });

  it("hides under an open menu of the consumer", () => {
    expect(
      placeView({
        ...base,
        occluders: [{ x: 150, y: 100, width: 100, height: 100 }],
      }).hidden,
    ).toBe(true);
    // A menu elsewhere leaves it alone.
    expect(
      placeView({
        ...base,
        occluders: [{ x: 500, y: 400, width: 100, height: 100 }],
      }).hidden,
    ).toBe(false);
  });

  it("hides an overlay that draws nothing", () => {
    expect(placeView({ ...base, drawn: false }).hidden).toBe(true);
  });

  it("cuts the frame by every clipping box above it", () => {
    expect(
      visibleBox({ x: 0, y: 0, width: 500, height: 500 }, [
        { x: 0, y: 100, width: 500, height: 500 },
        { x: 50, y: 0, width: 300, height: 1000 },
      ]),
    ).toEqual({ x: 50, y: 100, width: 300, height: 400 });
    expect(
      intersect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 5, height: 5 },
      ).width,
    ).toBe(0);
  });

  it("only takes finite numbers from a frame, within bounds", () => {
    expect(readRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(readRect({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(readRect({ x: "1", y: 0, width: 1, height: 1 })).toBeNull();
    expect(readRect(null)).toBeNull();
    expect(readRect({ x: 1e12, y: -1e12, width: -5, height: 1e12 })).toEqual({
      x: 100_000,
      y: -100_000,
      width: 0,
      height: 100_000,
    });
  });
});
