import { forwardRef, createElement, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Play } from "lucide-react";
import { decode, encode, iconToWire, lucideName } from "@/plugin-frame/wire";
import { decodeIcon, decodeIconValue } from "@/plugin-frame/frame-icons";
import { isWireIcon } from "@/plugin-frame/protocol";

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
    expect(iconToWire(createElement(Play))).toEqual({
      $icon: "Play",
      element: true,
    });
    expect(iconToWire(createElement(Play, { size: 14 }))).toEqual({
      $icon: "Play",
      element: true,
      size: 14,
    });
    const Custom = forwardRef(function Custom() {
      return null;
    });
    expect(iconToWire(Custom)).toBeUndefined();
    const out = encode(
      { icon: createElement(Play), body: createElement("div") },
      { exportFn },
    );
    expect(out).toEqual({ icon: { $icon: "Play", element: true } });
  });

  it("gives an icon sent as an element back as an element", () => {
    const element = decodeIconValue(
      iconToWire(createElement(Play, { size: 14 })),
    );
    expect(isValidElement(element)).toBe(true);
    expect((element as { type: unknown }).type).toBe(Play);
    expect((element as { props: { size?: number } }).props.size).toBe(14);
    expect(decodeIconValue(iconToWire(Play))).toBe(Play);
    expect(decodeIcon({ $icon: "Play", element: true })).toBe(Play);
  });

  it("refuses an icon marker with bad extra fields", () => {
    expect(isWireIcon({ $icon: "Play", element: "yes" })).toBe(false);
    expect(isWireIcon({ $icon: "Play", element: true, size: 9999 })).toBe(
      false,
    );
    expect(isWireIcon({ $icon: "Play", element: true, size: 14 })).toBe(true);
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
