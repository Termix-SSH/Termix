import { forwardRef, createElement, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Play } from "lucide-react";
import { decode, encode, iconToWire, lucideName } from "@/plugin-frame/wire";
import { decodeIcon, decodeIconValue } from "@/plugin-frame/frame-icons";
import { isWireIcon } from "@/plugin-frame/protocol";
import { withIconBoundary } from "@/plugin-host/scope";

const exportFn = vi.fn((fn: unknown) => ({ $fn: `f${String(fn).length}` }));

describe("wire encoding", () => {
  it("sends what replace gives in place of an object", () => {
    const secret = { focus: () => 1, disconnect: () => 2 };
    const out = encode(
      { handle: secret, other: { a: 1 } },
      {
        exportFn: () => ({ $fn: "f" }),
        replace: (value) =>
          value === secret ? { focus: secret.focus } : undefined,
      },
    );
    expect(out).toEqual({ handle: { focus: { $fn: "f" } }, other: { a: 1 } });
  });

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

  it("sends a plugin icon wrapped in core's boundary by its Lucide name", () => {
    const wrapped = withIconBoundary("demo", Play);
    expect(lucideName(wrapped)).toBe("Play");
    expect(iconToWire(wrapped)).toEqual(iconToWire(Play));
  });

  it("sends Lucide icons by name with their shapes and drops other React elements", () => {
    expect(lucideName(Play)).toBe("Play");
    const wire = iconToWire(Play);
    expect(wire).toMatchObject({ $icon: "Play" });
    expect(wire?.node).toEqual([
      ["path", expect.objectContaining({ d: expect.any(String) })],
    ]);
    expect(iconToWire(createElement(Play))).toMatchObject({
      $icon: "Play",
      element: true,
    });
    expect(iconToWire(createElement(Play, { size: 14 }))).toMatchObject({
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
    expect(out).toEqual({ icon: iconToWire(createElement(Play)) });
  });

  it("gives an icon sent as an element back as an element", () => {
    const byName = (name: string) => (name === "Play" ? Play : undefined);
    const element = decodeIconValue(
      iconToWire(createElement(Play, { size: 14 })),
      byName,
    );
    expect(isValidElement(element)).toBe(true);
    expect((element as { type: unknown }).type).toBe(Play);
    expect((element as { props: { size?: number } }).props.size).toBe(14);
    expect(decodeIconValue(iconToWire(Play), byName)).toBe(Play);
    expect(decodeIcon({ $icon: "Play", element: true }, byName)).toBe(Play);
  });

  it("draws an icon from its shapes where Lucide is not loaded", () => {
    const icon = decodeIcon(iconToWire(Play));
    expect(icon).not.toBe(Play);
    expect(lucideName(icon)).toBe("Play");
    expect(iconToWire(icon)).toEqual(iconToWire(Play));
  });

  it("sends an object shared by two fields both times, and still cuts loops", () => {
    const shared = { name: "web" };
    const loop: Record<string, unknown> = { id: 1 };
    loop.self = loop;
    const out = encode({ a: shared, b: [shared], loop }, { exportFn }) as {
      a: unknown;
      b: unknown[];
      loop: Record<string, unknown>;
    };
    expect(out.a).toEqual({ name: "web" });
    expect(out.b).toEqual([{ name: "web" }]);
    expect(out.loop).toEqual({ id: 1 });
  });

  it("keeps the shapes of an icon used twice in one message", () => {
    const out = encode(
      { a: { icon: iconToWire(Play) }, b: [{ icon: iconToWire(Play) }] },
      { exportFn },
    ) as { a: { icon: { node?: unknown } }; b: { icon: { node?: unknown } }[] };
    expect(Array.isArray(out.a.icon.node)).toBe(true);
    expect(Array.isArray(out.b[0].icon.node)).toBe(true);
  });

  it("drops shapes that are not plain geometry", () => {
    const icon = decodeIcon({
      $icon: "Evil",
      node: [["script", { d: "x" }]],
    });
    expect(lucideName(icon)).toBe("Puzzle");
    const safe = decodeIcon({
      $icon: "Shape",
      node: [["path", { d: "M0 0", onload: "alert(1)", href: "x" }]],
    });
    expect(iconToWire(safe)?.node).toEqual([["path", { d: "M0 0" }]]);
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
