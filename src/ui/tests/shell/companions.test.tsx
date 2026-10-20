import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Tab } from "@/types/ui-types";
import {
  arrangeCompanions,
  companionApplies,
  getCompanionState,
  registerCompanionDef,
  registerCompanionLayoutDef,
  resetCompanionLayouts,
  resetCompanions,
  resetCompanionStates,
  toggleCompanion,
} from "../../shell/companions";
import { CompanionFrame } from "../../shell/CompanionFrame";

const tab = (extra: Partial<Tab> = {}) =>
  ({
    id: "t1",
    type: "terminal",
    label: "box",
    host: { id: 1 },
    ...extra,
  }) as unknown as Tab;

afterEach(() => {
  resetCompanions();
  resetCompanionStates();
});

describe("companions", () => {
  it("applies by tab type and host", () => {
    const def = {
      id: "a",
      component: () => null,
      tabTypes: ["terminal"],
    };
    expect(companionApplies(def, tab())).toBe(true);
    expect(companionApplies(def, tab({ type: "files" }))).toBe(false);
    expect(companionApplies(def, tab({ host: undefined }))).toBe(false);
  });

  it("toggles open and closed, defaulting to the first match", () => {
    registerCompanionDef({ id: "a", component: () => null });
    toggleCompanion(tab());
    expect(getCompanionState("t1").openId).toBe("a");
    toggleCompanion(tab(), "a");
    expect(getCompanionState("t1").openId).toBeNull();
  });

  it("renders only the tab when nothing applies", () => {
    render(
      <CompanionFrame tab={tab()} isVisible>
        <div>content</div>
      </CompanionFrame>,
    );
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the panel from the edge button and keeps the tab mounted", () => {
    registerCompanionDef({
      id: "a",
      titleKey: "a.title",
      component: () => <div>panel body</div>,
    });
    render(
      <CompanionFrame tab={tab()} isVisible>
        <div>content</div>
      </CompanionFrame>,
    );
    expect(screen.queryByText("panel body")).toBeNull();
    fireEvent.click(screen.getByTitle("a.title"));
    expect(screen.getByText("panel body")).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
    act(() => toggleCompanion(tab(), "a"));
    expect(getCompanionState("t1").openId).toBeNull();
  });
});

describe("companion layout", () => {
  it("hides a companion and the whole bar by host layout", () => {
    registerCompanionLayoutDef({
      id: "layout",
      tabTypes: ["terminal"],
      resolve: (host) =>
        (host as unknown as { off?: boolean }).off
          ? { enabled: false }
          : { hidden: ["b"] },
    });
    const a = { id: "a", component: () => null };
    const b = { id: "b", component: () => null };
    expect(companionApplies(a, tab())).toBe(true);
    expect(companionApplies(b, tab())).toBe(false);
    expect(
      companionApplies(a, tab({ host: { id: 1, off: true } as never })),
    ).toBe(false);
    resetCompanionLayouts();
    expect(companionApplies(b, tab())).toBe(true);
  });

  it("orders by the saved list and keeps unknown ones after", () => {
    const defs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(arrangeCompanions(defs, ["c", "a"]).map((d) => d.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(arrangeCompanions(defs, undefined)).toBe(defs);
  });
});
