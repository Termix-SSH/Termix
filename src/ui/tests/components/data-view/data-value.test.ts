import { describe, expect, it } from "vitest";
import { parseDataValue } from "@/components/data-view/data-value";

describe("parseDataValue", () => {
  it("keeps every shape as given", () => {
    const values = [
      { shape: "bars", items: [{ label: "CPU", value: 0.5, detail: "4c" }] },
      { shape: "stat", items: [{ label: "Up", value: 3, unit: "d" }] },
      { shape: "badge", label: "Failing", tone: "bad", tooltip: "disk" },
      { shape: "dot", tone: "warn", label: "slow" },
      { shape: "text", text: "ok", tone: "good" },
    ];
    expect(parseDataValue(values)).toEqual(values);
  });

  it("takes one value as a list of one", () => {
    expect(parseDataValue({ shape: "dot", tone: "bad", label: "" })).toEqual([
      { shape: "dot", tone: "bad", label: "" },
    ]);
  });

  it("returns null for nothing", () => {
    expect(parseDataValue(null)).toBeNull();
    expect(parseDataValue(undefined)).toBeNull();
    expect(parseDataValue([])).toBeNull();
  });

  it("clamps bars and turns bad numbers into unknown", () => {
    expect(
      parseDataValue({
        shape: "bars",
        items: [
          { label: "a", value: 7 },
          { label: "b", value: -1 },
          { label: "c", value: Number.NaN },
          { label: "d", value: "50" },
        ],
      }),
    ).toEqual([
      {
        shape: "bars",
        items: [
          { label: "a", value: 1 },
          { label: "b", value: 0 },
          { label: "c", value: null },
          { label: "d", value: null },
        ],
      },
    ]);
  });

  it("drops unknown shapes, bad tones and items without a label", () => {
    expect(
      parseDataValue([
        { shape: "html", html: "<b>x</b>" },
        { shape: "dot", tone: "purple", label: "x" },
        { shape: "stat", items: [{ value: 1 }, { label: "ok", value: 2 }] },
        { shape: "badge", label: "x", tone: "loud" },
      ]),
    ).toEqual([
      { shape: "stat", items: [{ label: "ok", value: 2 }] },
      { shape: "badge", label: "x" },
    ]);
  });

  it("cuts long text and caps how many items and parts get through", () => {
    const [badge] = parseDataValue({ shape: "badge", label: "x".repeat(500) })!;
    expect((badge as { label: string }).label).toHaveLength(200);
    const bars = parseDataValue({
      shape: "bars",
      items: Array.from({ length: 50 }, (_, i) => ({
        label: `${i}`,
        value: 0,
      })),
    })!;
    expect((bars[0] as { items: unknown[] }).items).toHaveLength(12);
    const parts = parseDataValue(
      Array.from({ length: 20 }, () => ({ shape: "text", text: "a" })),
    )!;
    expect(parts).toHaveLength(8);
  });

  it("keeps only action ids that look like ids", () => {
    expect(
      parseDataValue([
        { shape: "badge", label: "a", actionId: "host-metrics.open" },
        { shape: "text", text: "b", actionId: "javascript:alert(1)" },
      ]),
    ).toEqual([
      { shape: "badge", label: "a", actionId: "host-metrics.open" },
      { shape: "text", text: "b" },
    ]);
  });

  it("drops shapes the slot does not draw", () => {
    expect(
      parseDataValue(
        [
          { shape: "badge", label: "a" },
          { shape: "dot", tone: "bad", label: "b" },
        ],
        ["badge"],
      ),
    ).toEqual([{ shape: "badge", label: "a" }]);
  });

  it("keeps a lucide icon name, a hex color and a known variant", () => {
    expect(
      parseDataValue([
        {
          shape: "badge",
          label: "KEY",
          icon: "KeyRound",
          color: "#2C5",
          variant: "filled",
        },
        {
          shape: "badge",
          label: "x",
          icon: "<img>",
          color: "red; background:url(x)",
          variant: "huge",
        },
        { shape: "text", text: "pw", icon: "Lock", color: "#f59e0b" },
      ]),
    ).toEqual([
      {
        shape: "badge",
        label: "KEY",
        icon: "KeyRound",
        color: "#22cc55",
        variant: "filled",
      },
      { shape: "badge", label: "x" },
      { shape: "text", text: "pw", icon: "Lock", color: "#f59e0b" },
    ]);
  });
});
