import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMenuResizeShim } from "@/plugin-frame/menu-resize";

let uninstall: () => void = () => {};
const closed = vi.fn();

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function openMenu() {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-radix-popper-content-wrapper", "");
  document.body.append(wrapper);
}

beforeEach(() => {
  setWidth(800);
  uninstall = installMenuResizeShim(window);
  // Like Radix Select, which closes on a resize.
  window.addEventListener("resize", closed);
});

afterEach(() => {
  window.removeEventListener("resize", closed);
  uninstall();
  document.body.innerHTML = "";
  closed.mockReset();
});

describe("menu resize shim", () => {
  it("keeps a menu open while the frame grows taller to fit it", () => {
    openMenu();
    window.dispatchEvent(new Event("resize"));
    expect(closed).not.toHaveBeenCalled();
  });

  it("still lets a real resize close the menu", () => {
    openMenu();
    setWidth(640);
    window.dispatchEvent(new Event("resize"));
    expect(closed).toHaveBeenCalledOnce();
  });

  it("passes every resize on while no menu is open", () => {
    window.dispatchEvent(new Event("resize"));
    expect(closed).toHaveBeenCalledOnce();
  });
});
