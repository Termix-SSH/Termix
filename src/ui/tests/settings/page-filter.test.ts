import { describe, expect, it } from "vitest";
import { filterSettingsPage, HIDDEN_ATTR } from "@/settings/page-filter";

function page() {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="bg-card" id="theme">
      <span>Appearance</span>
      <div data-setting-row="" id="font">Font size</div>
      <div data-setting-row="" id="accent">Accent color</div>
    </div>
    <div class="bg-card" id="account"><span>Account</span><div data-setting-row="" id="name">Username</div></div>
    <div class="hidden"><div class="bg-card" id="admin">Font policy</div></div>
  `;
  return root;
}

const hidden = (root: HTMLElement, id: string) =>
  root.querySelector(`#${id}`)!.hasAttribute(HIDDEN_ATTR);

describe("filterSettingsPage", () => {
  it("keeps only matching cards and rows", () => {
    const root = page();
    expect(filterSettingsPage(root, "font")).toBe(1);
    expect(hidden(root, "theme")).toBe(false);
    expect(hidden(root, "font")).toBe(false);
    expect(hidden(root, "accent")).toBe(true);
    expect(hidden(root, "account")).toBe(true);
  });

  it("keeps every row when only the card title matches", () => {
    const root = page();
    filterSettingsPage(root, "appearance");
    expect(hidden(root, "font")).toBe(false);
    expect(hidden(root, "accent")).toBe(false);
  });

  it("ignores cards in hidden panels and clears on an empty query", () => {
    const root = page();
    expect(filterSettingsPage(root, "policy")).toBe(0);
    expect(filterSettingsPage(root, "")).toBe(2);
    expect(root.querySelectorAll(`[${HIDDEN_ATTR}]`).length).toBe(0);
  });
});
