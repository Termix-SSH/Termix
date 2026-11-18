import { afterEach, describe, expect, it } from "vitest";
import { OPEN_MENU_ROOM, withOpenMenus } from "@/plugin-frame/frame-root";

function openMenu(bottom: number): HTMLElement {
  const menu = document.createElement("div");
  menu.setAttribute("data-radix-popper-content-wrapper", "");
  menu.getBoundingClientRect = () =>
    ({ bottom, top: bottom - 100, height: 100 }) as DOMRect;
  document.body.appendChild(menu);
  return menu;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("withOpenMenus", () => {
  it("keeps the content height with no menu open", () => {
    expect(withOpenMenus(45)).toBe(45);
  });

  it("leaves room below the content for an open menu", () => {
    openMenu(40);
    expect(withOpenMenus(45)).toBe(45 + OPEN_MENU_ROOM);
  });

  it("covers a menu that reaches past that room", () => {
    openMenu(600);
    expect(withOpenMenus(45)).toBe(608);
  });
});
