import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TileWall } from "../../../components/tile-grid/TileWall";
import { TileStack } from "../../../components/tile-grid/TileStack";
import { TileColumn } from "../../../components/tile-grid/TileColumn";
import { MetricCard } from "../../../components/metric-card";
import { SectionCard } from "../../../components/section-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

const cardOf = (text: string) =>
  screen.getByText(text).closest("[data-tile-card]") as HTMLElement;

describe("TileWall", () => {
  it("wraps each tile in a cell with the shared lines", () => {
    render(
      <TileWall size="2">
        <span>one</span>
        {null}
        <span>two</span>
      </TileWall>,
    );
    const cell = screen.getByText("one").parentElement!;
    expect(cell).toHaveClass("border-b", "border-r");
    expect(cell.parentElement?.children).toHaveLength(2);
  });

  it("drops the box of cards inside it", () => {
    render(
      <TileWall>
        <MetricCard title="CPU" icon={null}>
          x
        </MetricCard>
      </TileWall>,
    );
    expect(cardOf("CPU")).not.toHaveClass("border");
  });

  it("uses column classes in place of size", () => {
    render(
      <TileWall gridClassName="grid-cols-3">
        <span>a</span>
      </TileWall>,
    );
    const grid = screen.getByText("a").parentElement!.parentElement!;
    expect(grid).toHaveClass("grid-cols-3");
    expect(grid.style.gridTemplateColumns).toBe("");
  });
});

describe("bottom line", () => {
  const edgeOf = (text: string) =>
    screen.getByText(text).closest(".overflow-clip")!.firstElementChild;

  it("stays when the tiles do not reach the bottom of the screen", () => {
    render(
      <TileWall>
        <span>alone</span>
      </TileWall>,
    );
    expect(edgeOf("alone")).not.toHaveClass("-mb-px");
  });

  it("is left to the section inside a stack", () => {
    render(
      <TileStack>
        <TileWall>
          <span>nested</span>
        </TileWall>
      </TileStack>,
    );
    expect(edgeOf("nested")).toHaveClass("-mb-px");
  });

  it("is cut off once the tiles reach the bottom of the scroll area", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 0, bottom: 500 } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <div style={{ overflowY: "auto" }}>
        <TileWall>
          <span>full</span>
        </TileWall>
      </div>,
    );
    expect(edgeOf("full")).toHaveClass("-mb-px");
    rect.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("TileStack", () => {
  it("draws a line under each section", () => {
    render(
      <TileStack>
        <span>first</span>
        <span>second</span>
      </TileStack>,
    );
    expect(screen.getByText("first").parentElement).toHaveClass("border-b");
    expect(screen.getByText("second").parentElement).toHaveClass("border-b");
  });

  it("hides a section whose child renders nothing, like a closed editor", () => {
    const Closed = () => null;
    const { container } = render(
      <TileStack>
        <span>first</span>
        <Closed />
      </TileStack>,
    );
    const sections = container.querySelectorAll(".border-b");
    expect(sections[sections.length - 1]).toHaveClass("empty:hidden");
    expect(sections[sections.length - 1]).toBeEmptyDOMElement();
  });
});

describe("cards outside a tile layout", () => {
  it("keep their border but no fill", () => {
    render(
      <SectionCard title="Shell" icon={null}>
        body
      </SectionCard>,
    );
    const card = cardOf("Shell");
    expect(card).toHaveClass("border");
    expect(card).not.toHaveClass("bg-card");
  });

  it("drop the border inside a TileColumn", () => {
    render(
      <TileColumn>
        <div>
          <SectionCard title="Nested" icon={null}>
            body
          </SectionCard>
        </div>
      </TileColumn>,
    );
    expect(cardOf("Nested")).not.toHaveClass("border");
  });
});
