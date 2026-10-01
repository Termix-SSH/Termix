import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TabStrip } from "@/sidebar/HostManagerTabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reveals clipped tabs and updates the scroll controls after scrolling and resizing", () => {
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  const width = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(600);
  const scrollBy = vi.fn();
  HTMLElement.prototype.scrollBy = scrollBy;
  const onTabChange = vi.fn();
  const view = render(
    <TabStrip
      tabs={[
        { id: "general", label: "General", icon: null },
        { id: "metrics", label: "Metrics", icon: null },
      ]}
      activeTab="general"
      onTabChange={onTabChange}
    />,
  );
  const left = screen.getByLabelText(
    "common.scrollTabsLeft",
  ) as HTMLButtonElement;
  const right = screen.getByLabelText(
    "common.scrollTabsRight",
  ) as HTMLButtonElement;
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(false);
  fireEvent.click(right);
  expect(scrollBy).toHaveBeenCalledWith({ left: 150, behavior: "smooth" });
  const strip = view.container.querySelector(".overflow-x-auto") as HTMLElement;
  strip.scrollLeft = 400;
  fireEvent.scroll(strip);
  expect(left.disabled).toBe(false);
  expect(right.disabled).toBe(true);
  fireEvent.click(screen.getByText("Metrics"));
  expect(onTabChange).toHaveBeenCalledWith("metrics");
  strip.scrollLeft = 0;
  width.mockReturnValue(200);
  act(resize);
  expect(screen.queryByLabelText("common.scrollTabsRight")).toBeNull();
});
