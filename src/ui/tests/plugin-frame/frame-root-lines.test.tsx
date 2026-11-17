import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { FrameRoot, setFrameProps } from "@/plugin-frame/frame-root";
import { SectionCard } from "@/components/section-card";

function Cards() {
  return (
    <>
      <SectionCard title="One" icon={null}>
        a
      </SectionCard>
      <SectionCard title="Two" icon={null}>
        b
      </SectionCard>
    </>
  );
}

afterEach(() => {
  cleanup();
  act(() => setFrameProps({}));
});

describe("FrameRoot card lines", () => {
  it("draws the column's lines between cards in a seamless content frame", () => {
    act(() => setFrameProps({ __place: { seamless: true } }));
    const { container } = render(<FrameRoot fit="content" component={Cards} />);
    const card = container.querySelector("[data-tile-card]")!;
    expect(card.className).not.toContain("border border-border");
    expect(card.parentElement!.className).toContain(
      "[&_[data-tile-card]]:border-b",
    );
  });

  it("leaves a frame outside a column alone", () => {
    const { container } = render(<FrameRoot fit="content" component={Cards} />);
    const card = container.querySelector("[data-tile-card]")!;
    expect(card.className).toContain("border border-border");
    expect(card.parentElement!.className).not.toContain(
      "[&_[data-tile-card]]:border-b",
    );
  });
});
