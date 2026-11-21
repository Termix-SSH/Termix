import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { DataValues } from "@/components/data-view/DataValues";

describe("DataValues", () => {
  it("draws nothing without values", () => {
    expect(render(<DataValues values={null} />).container.innerHTML).toBe("");
    expect(render(<DataValues values={[]} />).container.innerHTML).toBe("");
  });

  it("draws bars with their percent and tones them by value", () => {
    const { container } = render(
      <DataValues
        values={[
          {
            shape: "bars",
            items: [
              { label: "CPU", value: 0.42 },
              { label: "RAM", value: 0.75 },
              { label: "Disk", value: 0.95 },
              { label: "Swap", value: null },
            ],
          },
        ]}
      />,
    );
    const bars = container.querySelectorAll("[data-data-bar]");
    expect(bars).toHaveLength(4);
    expect(bars[0].textContent).toContain("CPU");
    expect(bars[0].textContent).toContain("42%");
    expect(bars[1].innerHTML).toContain("bg-warning");
    expect(bars[2].innerHTML).toContain("bg-destructive");
    expect(bars[3].textContent).toContain("-");
  });

  it("draws stats with units and a tooltip", () => {
    const { container } = render(
      <DataValues
        layout="stack"
        values={[
          {
            shape: "stat",
            items: [{ label: "Uptime", value: 3, unit: "d", tooltip: "since" }],
          },
        ]}
      />,
    );
    const stat = container.querySelector("[data-data-stat]")!;
    expect(stat.textContent).toBe("Uptime3 d");
    expect(stat.getAttribute("title")).toBe("since");
  });

  it("draws badges, dots and text with their tone", () => {
    const { container } = render(
      <DataValues
        values={[
          { shape: "badge", label: "Failing", tone: "bad" },
          { shape: "dot", tone: "warn", label: "slow" },
          { shape: "text", text: "Synced" },
        ]}
      />,
    );
    expect(
      container.querySelector("[data-data-badge='bad']")?.textContent,
    ).toBe("Failing");
    const dot = container.querySelector("[data-data-dot='warn']")!;
    expect(dot.getAttribute("title")).toBe("slow");
    expect(container.textContent).toContain("Synced");
  });

  it("makes a value with an action a button only when the owner can run it", () => {
    const onAction = vi.fn();
    const value = [
      { shape: "badge" as const, label: "Open", actionId: "x.open" },
    ];
    const plain = render(<DataValues values={value} />);
    expect(plain.container.querySelector("button")).toBeNull();
    const { container } = render(
      <DataValues values={value} onAction={onAction} />,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(onAction).toHaveBeenCalledWith("x.open");
  });

  it("lays bars out per layout", () => {
    const value = [
      { shape: "bars" as const, items: [{ label: "CPU", value: 0.1 }] },
    ];
    for (const layout of ["row", "stack", "inline"] as const) {
      const { container } = render(
        <DataValues values={value} layout={layout} />,
      );
      expect(
        container.querySelector(`[data-data-view='${layout}']`),
      ).not.toBeNull();
    }
  });

  it("draws a badge's icon and color, and an icon only badge with its label hidden", () => {
    const { container } = render(
      <DataValues
        values={[
          { shape: "badge", label: "KEY", icon: "KeyRound", color: "#22c55e" },
          { shape: "badge", label: "Password", icon: "Lock", variant: "icon" },
          { shape: "text", text: "agent", icon: "Bot", color: "#3b82f6" },
        ]}
      />,
    );
    const badges = container.querySelectorAll("[data-data-badge]");
    const first = badges[0]!.parentElement!;
    expect(first.querySelector("svg")).not.toBeNull();
    expect(first.getAttribute("style")).toContain("#22c55e");
    const iconOnly = badges[1]!;
    expect(iconOnly.className).toContain("sr-only");
    expect(iconOnly.parentElement!.getAttribute("title")).toBe("Password");
    expect(container.textContent).toContain("agent");
  });
});
