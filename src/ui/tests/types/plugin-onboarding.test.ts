import { describe, expect, it } from "vitest";
import {
  applyOrder,
  isPluginChoice,
  resolvePluginChoices,
  type ChoicePlugin,
} from "@/types/plugin-onboarding";

const plugins: ChoicePlugin[] = [
  { id: "base", dependencies: [] },
  { id: "mid", dependencies: ["base"] },
  { id: "top", dependencies: ["mid"] },
  { id: "solo", dependencies: [] },
];

describe("resolvePluginChoices", () => {
  it("leaves consistent choices alone", () => {
    const choices = {
      base: "enabled",
      mid: "enabled",
      top: "disabled",
      solo: "remove",
    } as const;
    const result = resolvePluginChoices(plugins, choices);
    expect(result.choices).toEqual(choices);
    expect(result.adjustments).toEqual([]);
  });

  it("enables the whole chain under an enabled plugin", () => {
    const result = resolvePluginChoices(plugins, {
      base: "remove",
      mid: "disabled",
      top: "enabled",
    });
    expect(result.choices).toEqual({
      base: "enabled",
      mid: "enabled",
      top: "enabled",
    });
    expect(result.adjustments).toEqual([
      { id: "base", from: "remove", to: "enabled", requiredBy: ["mid"] },
      { id: "mid", from: "disabled", to: "enabled", requiredBy: ["top"] },
    ]);
  });

  it("keeps a dependency of a disabled plugin instead of removing it", () => {
    const result = resolvePluginChoices(plugins, {
      base: "remove",
      mid: "disabled",
    });
    expect(result.choices.base).toBe("disabled");
  });

  it("lets a removed plugin take nothing with it", () => {
    const result = resolvePluginChoices(plugins, {
      base: "remove",
      mid: "remove",
      top: "remove",
    });
    expect(result.adjustments).toEqual([]);
  });

  it("ignores unknown dependencies and survives cycles", () => {
    const cyclic: ChoicePlugin[] = [
      { id: "a", dependencies: ["b", "ghost"] },
      { id: "b", dependencies: ["a"] },
    ];
    const result = resolvePluginChoices(cyclic, { a: "enabled", b: "remove" });
    expect(result.choices).toEqual({ a: "enabled", b: "enabled" });
  });
});

describe("applyOrder", () => {
  it("enables dependencies first and removes dependents first", () => {
    const order = applyOrder(plugins, {
      base: "enabled",
      mid: "enabled",
      top: "enabled",
    });
    expect(order.enable).toEqual(["base", "mid", "top"]);

    const removal = applyOrder(plugins, {
      base: "remove",
      mid: "remove",
      top: "remove",
      solo: "disabled",
    });
    expect(removal.remove).toEqual(["top", "mid", "base"]);
    expect(removal.disable).toEqual(["solo"]);
  });
});

describe("isPluginChoice", () => {
  it("accepts only the three choices", () => {
    expect(isPluginChoice("enabled")).toBe(true);
    expect(isPluginChoice("remove")).toBe(true);
    expect(isPluginChoice("delete")).toBe(false);
  });
});
