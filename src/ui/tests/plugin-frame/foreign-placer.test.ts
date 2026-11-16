import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForeignPlacer,
  scrollParents,
  scrollTarget,
  type PlaceBatch,
} from "@/plugin-frame/foreign-placer";

let frames: Array<() => void>;

function rect(element: Element, x: number, y: number, w: number, h: number) {
  element.getBoundingClientRect = () =>
    ({
      left: x,
      top: y,
      width: w,
      height: h,
      x,
      y,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
}

function runFrame() {
  const next = frames.splice(0);
  for (const frame of next) frame();
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setup(now = () => 0) {
  const sent: PlaceBatch[] = [];
  const placer = new ForeignPlacer((batch) => sent.push(batch), now);
  return { placer, sent };
}

describe("placeholder reports", () => {
  it("sends one batch per animation frame for many changes", () => {
    const { placer, sent } = setup();
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    rect(a, 0, 0, 100, 50);
    rect(b, 0, 60, 100, 50);
    placer.add("a", a, true);
    placer.add("b", b, true);
    placer.kick();
    placer.kick();
    expect(sent).toHaveLength(0);
    runFrame();
    expect(sent).toHaveLength(1);
    expect(sent[0].views.map((view) => view.id)).toEqual(["a", "b"]);
    expect(sent[0].views[0]).toMatchObject({
      rect: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      interactive: true,
      clip: null,
    });
  });

  it("only sends what changed", () => {
    const { placer, sent } = setup();
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    rect(a, 0, 0, 100, 50);
    rect(b, 0, 60, 100, 50);
    placer.add("a", a, true);
    placer.add("b", b, true);
    runFrame();
    rect(b, 0, 70, 100, 50);
    placer.kick();
    runFrame();
    expect(sent[1].views.map((view) => view.id)).toEqual(["b"]);
    placer.kick();
    runFrame();
    expect(sent).toHaveLength(2);
  });

  it("clips to every box above that cuts its content", () => {
    const { placer, sent } = setup();
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    const inner = document.createElement("div");
    inner.style.overflow = "hidden";
    const spot = document.createElement("div");
    inner.append(spot);
    outer.append(inner);
    document.body.append(outer);
    rect(outer, 0, 100, 500, 300);
    rect(inner, 50, 0, 200, 1000);
    rect(spot, 60, 350, 100, 100);
    expect(scrollParents(spot)).toEqual([inner, outer]);
    placer.add("s", spot, true);
    runFrame();
    expect(sent[0].views[0].clip).toEqual({
      x: 50,
      y: 100,
      width: 200,
      height: 300,
    });
  });

  it("says a placeholder outside every visible box is not visible", () => {
    const { placer, sent } = setup();
    const box = document.createElement("div");
    box.style.overflow = "auto";
    const spot = document.createElement("div");
    box.append(spot);
    document.body.append(box);
    rect(box, 0, 0, 300, 300);
    rect(spot, 0, 400, 100, 100);
    placer.add("s", spot, true);
    runFrame();
    // Inside the viewport, but scrolled out of its box.
    expect(sent[0].views[0].visible).toBe(true);
    rect(box, 0, 2000, 300, 300);
    placer.kick();
    runFrame();
    expect(sent[1].views[0].visible).toBe(false);
  });

  it("reports menus over a placeholder, not the dialog it sits in", () => {
    const { placer, sent } = setup();
    const spot = document.createElement("div");
    const dialog = document.createElement("div");
    const inDialog = document.createElement("div");
    dialog.append(inDialog);
    const menu = document.createElement("div");
    document.body.append(spot, dialog, menu);
    rect(spot, 0, 0, 100, 100);
    rect(dialog, 0, 0, 500, 500);
    rect(inDialog, 10, 10, 50, 50);
    rect(menu, 10, 10, 50, 50);
    placer.add("s", spot, true);
    placer.add("d", inDialog, true);
    runFrame();
    const stopDialog = placer.addOccluder(dialog);
    runFrame();
    const last = () => sent[sent.length - 1];
    // The page part under the dialog is covered, the part in it is not.
    expect(last().views.find((v) => v.id === "s")!.covers).toEqual([
      { x: 0, y: 0, width: 500, height: 500 },
    ]);
    expect(last().views.find((v) => v.id === "d")).toBeUndefined();
    // A menu opened later covers both.
    const stopMenu = placer.addOccluder(menu);
    runFrame();
    expect(last().views.find((v) => v.id === "d")!.covers).toEqual([
      { x: 10, y: 10, width: 50, height: 50 },
    ]);
    stopMenu();
    stopDialog();
    runFrame();
    expect(last().views.every((v) => v.covers.length === 0)).toBe(true);
    placer.setDragging(true);
    runFrame();
    expect(last().dragging).toBe(true);
    placer.update("s", false);
    runFrame();
    expect(last().views[0].interactive).toBe(false);
  });

  it("keeps measuring a little after a change, then stops", () => {
    let now = 0;
    const { placer } = setup(() => now);
    const spot = document.createElement("div");
    document.body.append(spot);
    rect(spot, 0, 0, 10, 10);
    placer.add("s", spot, true);
    runFrame();
    expect(frames).toHaveLength(1);
    now = 10_000;
    runFrame();
    expect(frames).toHaveLength(0);
  });

  it("forgets a removed placeholder", () => {
    const { placer, sent } = setup();
    const spot = document.createElement("div");
    document.body.append(spot);
    rect(spot, 0, 0, 10, 10);
    placer.add("s", spot, true);
    placer.remove("s");
    runFrame();
    expect(sent).toHaveLength(0);
  });

  it("finds the box that scrolls for wheel moves", () => {
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 500 });
    Object.defineProperty(box, "clientHeight", { value: 100 });
    const spot = document.createElement("div");
    box.append(spot);
    document.body.append(box);
    expect(scrollTarget(spot)).toBe(box);
  });
});
