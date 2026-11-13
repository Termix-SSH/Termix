import { forwardRef, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Play } from "lucide-react";
import { decode, encode, iconToWire, lucideName } from "@/plugin-frame/wire";

const exportFn = vi.fn((fn: unknown) => ({ $fn: `f${String(fn).length}` }));

describe("wire encoding", () => {
  it("sends functions by reference and plain data as it is", () => {
    const fn = () => 1;
    const out = encode(
      { name: "x", n: 2, ok: true, list: [1, "a"], run: fn },
      { exportFn: (f) => ({ $fn: f === fn ? "f1" : "other" }) },
    );
    expect(out).toEqual({
      name: "x",
      n: 2,
      ok: true,
      list: [1, "a"],
      run: { $fn: "f1" },
    });
  });

  it("sends Lucide icons by name and drops other React elements", () => {
    expect(lucideName(Play)).toBe("Play");
    expect(iconToWire(Play)).toEqual({ $icon: "Play" });
    expect(iconToWire(createElement(Play))).toEqual({ $icon: "Play" });
    const Custom = forwardRef(function Custom() {
      return null;
    });
    expect(iconToWire(Custom)).toBeUndefined();
    const out = encode(
      { icon: createElement(Play), body: createElement("div") },
      { exportFn },
    );
    expect(out).toEqual({ icon: { $icon: "Play" } });
  });

  it("drops DOM nodes and cycles instead of throwing", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const out = encode(
      { node: document.createElement("div"), loop },
      { exportFn },
    ) as Record<string, unknown>;
    expect(out.node).toBeUndefined();
    expect(out.loop).toEqual({ a: 1 });
  });

  it("decodes references into async stand-ins and never builds prototypes", () => {
    const calls: unknown[][] = [];
    const out = decode(
      JSON.parse(
        '{"run":{"$fn":"s1"},"__proto__":{"polluted":true},"icon":{"$icon":"Play"},"view":{"$component":"tab:x"}}',
      ),
      {
        importFn:
          () =>
          async (...args: unknown[]) => {
            calls.push(args);
            return "done";
          },
        icon: (ref) => `icon:${ref.$icon}`,
        component: (ref) => `component:${ref.$component}`,
      },
    ) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.icon).toBe("icon:Play");
    expect(out.view).toBe("component:tab:x");
    return (out.run as (a: number) => Promise<string>)(5).then((value) => {
      expect(value).toBe("done");
      expect(calls).toEqual([[5]]);
    });
  });

  it("refuses icon names that are not component names", () => {
    const out = decode(
      { icon: { $icon: "<img src=x>" } },
      { importFn: () => async () => null, icon: () => "icon" },
    ) as Record<string, unknown>;
    // Left as inert data, never handed to the icon lookup.
    expect(out.icon).toEqual({ $icon: "<img src=x>" });
  });
});
