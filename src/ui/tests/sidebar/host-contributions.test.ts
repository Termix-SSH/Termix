import { afterEach, describe, expect, it } from "vitest";
import {
  hostEditorToolbarItemsFor,
  hostStatusIndicatorsFor,
  registerHostBadge,
  registerHostEditorToolbarItem,
  registerHostStatusIndicator,
  resetHostContributions,
  type HostBadgeDef,
} from "@/sidebar/host-contributions";
import type { Host } from "@/types/ui-types";

const Noop = () => null;
const host = { id: 1 } as unknown as Host;

function def(id: string, extra: Partial<HostBadgeDef> = {}): HostBadgeDef {
  return { id, when: () => true, component: Noop, ...extra };
}

afterEach(() => resetHostContributions());

describe("host status indicators and editor toolbar items", () => {
  it("filters indicators by their when and survives a throwing one", () => {
    registerHostStatusIndicator(def("a"));
    registerHostStatusIndicator(def("b", { when: () => false }));
    registerHostStatusIndicator(
      def("c", {
        when: () => {
          throw new Error("boom");
        },
      }),
    );
    const all = [
      def("a"),
      def("b", { when: () => false }),
      def("c", {
        when: () => {
          throw new Error("boom");
        },
      }),
    ];
    expect(hostStatusIndicatorsFor(all, host).map((i) => i.id)).toEqual(["a"]);
  });

  it("filters toolbar items by their when", () => {
    const all = [def("x"), def("y", { when: () => false })];
    expect(hostEditorToolbarItemsFor(all, host).map((i) => i.id)).toEqual([
      "x",
    ]);
  });

  it("keeps the registries separate from badges", () => {
    const stopBadge = registerHostBadge(def("badge"));
    const stopItem = registerHostEditorToolbarItem(def("item"));
    stopBadge();
    stopItem();
    expect(stopBadge).toBeTypeOf("function");
  });
});
