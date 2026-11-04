import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { TileGrid } from "../../../components/tile-grid/TileGrid";
import { MetricCard } from "../../../components/metric-card";
import type { TileSlot } from "../../../components/tile-grid/layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// 1212px wide grid: one column is (1212 + 12) / 12 = 102px.
let gridWidth = 1212;
const PITCH = 102;
const original = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  document.documentElement.style.fontSize = "14px";
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.tgCard) return { height: 200, width: 0 } as DOMRect;
    return {
      left: 0,
      top: 0,
      width: gridWidth,
      height: 0,
      right: gridWidth,
      bottom: 0,
    } as DOMRect;
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
  document.documentElement.style.removeProperty("font-size");
  vi.unstubAllGlobals();
});
beforeEach(() => {
  gridWidth = 1212;
});
afterEach(cleanup);

const three: TileSlot[] = [
  { id: "cpu", x: 0, y: 0, w: 4, h: null },
  { id: "memory", x: 4, y: 0, w: 4, h: null },
  { id: "disk", x: 8, y: 0, w: 4, h: null },
];

function mount(layout = three, editMode = true) {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(layout);
    return (
      <TileGrid
        slots={value}
        gap={12}
        minHeight={80}
        editMode={editMode}
        tileLabel={(id) => id}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
        renderTile={(id) => <div data-testid={`body-${id}`}>{id}</div>}
      />
    );
  }
  return { ...render(<Harness />), changed };
}

const tile = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tg-tile="${id}"]`)!;
const position = (element: HTMLElement) => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    element.style.transform,
  )!;
  return { x: Number(match[1]), y: Number(match[2]) };
};
const pointer = (
  target: Element | Window,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  x: number,
  y: number,
) =>
  fireEvent[type](target, { clientX: x, clientY: y, button: 0, pointerId: 1 });
const slot = (slots: TileSlot[], id: string) => slots.find((s) => s.id === id)!;

describe("TileGrid", () => {
  it("places tiles on the 12 column grid", () => {
    mount();
    expect(position(tile("cpu"))).toEqual({ x: 0, y: 0 });
    expect(position(tile("memory"))).toEqual({ x: 4 * PITCH, y: 0 });
    expect(position(tile("disk"))).toEqual({ x: 8 * PITCH, y: 0 });
    expect(tile("cpu").style.width).toBe(`${4 * PITCH - 12}px`);
  });

  it("drops a dragged card exactly where the preview showed it", () => {
    const { changed } = mount();
    pointer(screen.getByTestId("body-cpu"), "pointerDown", 10, 10);
    pointer(window, "pointerMove", 10 + 4 * PITCH, 300);
    const ghost = document.querySelector<HTMLElement>(
      "[data-tg-drop-preview]",
    )!;
    const previewed = position(ghost);
    expect(previewed).toEqual({ x: 4 * PITCH, y: 212 });
    expect(position(tile("memory"))).toEqual({ x: 4 * PITCH, y: 0 });
    expect(position(tile("disk"))).toEqual({ x: 8 * PITCH, y: 0 });
    pointer(window, "pointerUp", 10 + 4 * PITCH, 300);
    const next = changed.mock.calls[0][0] as TileSlot[];
    expect(slot(next, "cpu")).toMatchObject({ x: 4, y: 212 });
    expect(position(tile("cpu"))).toEqual(previewed);
    expect(slot(next, "memory")).toMatchObject({ x: 4, y: 0 });
    expect(slot(next, "disk")).toMatchObject({ x: 8, y: 0 });
  });

  it("moves a card into another column without touching the rest", () => {
    const layout: TileSlot[] = [
      { id: "cpu", x: 0, y: 0, w: 4, h: null },
      { id: "memory", x: 4, y: 0, w: 4, h: null },
    ];
    const { changed } = mount(layout);
    pointer(screen.getByTestId("body-cpu"), "pointerDown", 10, 10);
    pointer(window, "pointerMove", 10 + 8 * PITCH, 10);
    pointer(window, "pointerUp", 10 + 8 * PITCH, 10);
    const next = changed.mock.calls[0][0] as TileSlot[];
    expect(slot(next, "cpu")).toMatchObject({ x: 8, y: 0 });
    expect(slot(next, "memory")).toMatchObject({ x: 4, y: 0 });
  });

  it("does nothing on a click without movement", () => {
    const { changed } = mount();
    pointer(screen.getByTestId("body-cpu"), "pointerDown", 10, 10);
    pointer(window, "pointerMove", 12, 11);
    pointer(window, "pointerUp", 12, 11);
    expect(changed).not.toHaveBeenCalled();
  });

  it("only pushes the overlapping card when a card gets wider", () => {
    const { changed } = mount();
    const edge = tile("cpu").querySelector(".tg-edge-right")!;
    pointer(edge, "pointerDown", 400, 100);
    pointer(window, "pointerMove", 400 + 2 * PITCH, 100);
    expect(tile("cpu").dataset.active).toBe("resize");
    pointer(window, "pointerUp", 400 + 2 * PITCH, 100);
    const next = changed.mock.calls[0][0] as TileSlot[];
    expect(slot(next, "cpu")).toMatchObject({ x: 0, y: 0, w: 6 });
    expect(slot(next, "memory")).toMatchObject({ x: 4, y: 212 });
    expect(slot(next, "disk")).toMatchObject({ x: 8, y: 0, w: 4 });
  });

  it("resizes from the left edge keeping the right side in place", () => {
    const { changed } = mount();
    const edge = tile("disk").querySelector(".tg-edge-left")!;
    pointer(edge, "pointerDown", 8 * PITCH, 100);
    pointer(window, "pointerMove", 8 * PITCH + 2 * PITCH, 100);
    pointer(window, "pointerUp", 8 * PITCH + 2 * PITCH, 100);
    const next = changed.mock.calls[0][0] as TileSlot[];
    expect(slot(next, "disk")).toMatchObject({ x: 10, w: 2 });
  });

  it("pins the height and snaps to a neighbour's bottom", () => {
    const layout: TileSlot[] = [
      { id: "cpu", x: 0, y: 0, w: 4, h: null },
      { id: "memory", x: 4, y: 0, w: 4, h: 300 },
    ];
    const { changed } = mount(layout);
    const edge = tile("memory").querySelector(".tg-edge-bottom")!;
    pointer(edge, "pointerDown", 500, 300);
    pointer(window, "pointerMove", 500, 196);
    pointer(window, "pointerUp", 500, 196);
    const next = changed.mock.calls[0][0] as TileSlot[];
    expect(slot(next, "memory").h).toBe(200);
  });

  it("cancels on Escape without saving", () => {
    const { changed } = mount();
    pointer(screen.getByTestId("body-cpu"), "pointerDown", 10, 10);
    pointer(window, "pointerMove", 10, 300);
    fireEvent.keyDown(window, { key: "Escape" });
    pointer(window, "pointerUp", 10, 300);
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector("[data-tg-drop-preview]")).toBeNull();
    expect(position(tile("cpu"))).toEqual({ x: 0, y: 0 });
  });

  it("resizes and moves with the keyboard", () => {
    const { changed } = mount();
    const width = tile("disk").querySelector('[aria-orientation="vertical"]')!;
    fireEvent.keyDown(width, { key: "ArrowLeft" });
    expect(slot(changed.mock.calls[0][0], "disk").w).toBe(3);
    const grip = tile("cpu").querySelector("[data-tg-grip]")!;
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(slot(changed.mock.calls[1][0], "cpu").x).toBe(1);
    expect(slot(changed.mock.calls[1][0], "memory")).toMatchObject({ y: 212 });
  });

  it("removes tiles", () => {
    const { changed } = mount();
    fireEvent.click(screen.getAllByLabelText("tileGrid.remove")[0]);
    expect(changed.mock.calls[0][0]).toHaveLength(2);
  });

  it("draws each line between edge to edge tiles once", () => {
    render(
      <TileGrid
        slots={[
          { id: "cpu", x: 0, y: 0, w: 4, h: 100 },
          { id: "memory", x: 4, y: 0, w: 4, h: 300 },
          { id: "disk", x: 0, y: 100, w: 4, h: 50 },
        ]}
        editMode={false}
        tileLabel={(id) => id}
        onChange={() => {}}
        renderTile={(id) => <div>{id}</div>}
      />,
    );
    // Whole px tiles that touch, with no lines of their own.
    expect(position(tile("memory")).x).toBe(404);
    expect(parseFloat(tile("cpu").style.width)).toBe(404);
    expect(parseFloat(tile("cpu").style.height)).toBe(100);
    expect(tile("cpu").querySelector(".tg-card")!.className).not.toMatch(
      /(^| )border/,
    );
    const vertical = [
      ...document.querySelectorAll<HTMLElement>("[data-tg-line].border-l"),
    ].map((el) => [
      parseFloat(el.style.left),
      parseFloat(el.style.top),
      parseFloat(el.style.height),
    ]);
    // One line down the middle, as tall as the taller side, and one on the
    // open right edge of the middle tile. Drawn as borders so they are as
    // thin as other lines at any display scaling.
    expect(vertical).toEqual([
      [404, 0, 301],
      [808, 0, 301],
    ]);
  });

  it("gives metric cards the tile look only in an edge to edge grid", () => {
    const card = (gap?: number) =>
      render(
        <TileGrid
          slots={[{ id: "cpu", x: 0, y: 0, w: 4, h: null }]}
          gap={gap}
          editMode={false}
          tileLabel={(id) => id}
          onChange={() => {}}
          renderTile={() => (
            <MetricCard title="CPU" icon={null}>
              x
            </MetricCard>
          )}
        />,
      ).container.querySelector(".tg-content > div")!.className;
    expect(card()).not.toContain("bg-card");
    cleanup();
    expect(card(12)).toContain("border border-border bg-card");
  });

  it("stacks cards with no edit controls on narrow screens", () => {
    gridWidth = 500;
    mount();
    expect(document.querySelector("[data-tg-tile]")).toBeNull();
    expect(screen.getByTestId("body-disk")).toBeInTheDocument();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  });

  it("shows no edit controls outside edit mode", () => {
    mount(three, false);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    pointer(screen.getByTestId("body-cpu"), "pointerDown", 10, 10);
    expect(document.querySelector("[data-active]")).toBeNull();
  });
});
