import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import { SidebarTree } from "@/sidebar/tree/SidebarTree";

vi.mock("@/lib/host-connection-tabs", () => ({
  resolveHostTabType: () => "terminal",
}));
vi.mock("@/main-axios", () => ({}));
vi.mock("@/api/plugins-api", () => ({}));
vi.mock("@/settings/HostPluginSections", () => ({
  usePluginHostSections: () => [],
}));
vi.mock("@/contexts/UiPreferencesContext", () => ({
  useAreaPreferences: () => ({ showResourceBars: false, rowActions: "hover" }),
}));
vi.mock("@/sidebar/FolderMetadataDialog", () => ({
  FolderMetadataDialog: () => null,
}));
vi.mock("@/sidebar/HostShareModal", () => ({ HostShareModal: () => null }));
vi.mock("@/sidebar/tree/FolderItem/FolderItem", () => ({
  FolderItem: () => <div>Folder</div>,
  folderHostCount: () => 1,
}));
vi.mock("@/sidebar/tree/HostItem/HostItem", () => ({
  HostItem: () => <div>Host</div>,
}));

const observers: Array<{
  callback: ResizeObserverCallback;
  nodes: Set<Element>;
}> = [];
let hostHeight = 55;
function rect(element: Element): DOMRect {
  const index = element.getAttribute("data-index");
  const height = index === "0" ? 40 : index === "1" ? hostHeight : 600;
  return {
    x: 0,
    y: 0,
    width: 300,
    height,
    top: 0,
    left: 0,
    right: 300,
    bottom: height,
    toJSON() {},
  };
}
function resize(rows: Element[]) {
  act(() => {
    for (const observer of observers) {
      const entries = rows
        .filter((row) => observer.nodes.has(row))
        .map(
          (target) =>
            ({
              target,
              borderBoxSize: [
                { blockSize: rect(target).height, inlineSize: 300 },
              ],
            }) as unknown as ResizeObserverEntry,
        );
      if (entries.length) observer.callback(entries, {} as ResizeObserver);
    }
  });
}

beforeEach(() => {
  localStorage.setItem("hostOpenFolders", JSON.stringify(["group"]));
  hostHeight = 55;
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      nodes = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, nodes: this.nodes });
      }
      observe(node: Element) {
        this.nodes.add(node);
      }
      unobserve(node: Element) {
        this.nodes.delete(node);
      }
      disconnect() {
        this.nodes.clear();
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      return rect(this);
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("keeps an unchanged folder's measured height after changing density", () => {
  const host = {
    id: "1",
    name: "Host",
    ip: "example.com",
    username: "test",
  } as Host;
  const children = [
    { name: "group", path: "group", children: [host] },
  ] as HostFolder[];
  const props = {
    children,
    onOpenTab: vi.fn(),
    onEditHost: vi.fn(),
    selectionMode: false,
    onToggleSelectionMode: vi.fn(),
  };
  const view = render(<SidebarTree {...props} density="comfortable" />);
  const rows = () =>
    Array.from(view.container.querySelectorAll("[data-index]"));
  expect(rows()).toHaveLength(2);
  resize(rows());
  expect((rows()[1] as HTMLElement).style.transform).toBe("translateY(40px)");
  hostHeight = 30;
  view.rerender(<SidebarTree {...props} density="compact" />);
  // Folder height is unchanged, so the browser only reports the host resize.
  resize([rows()[1]]);
  expect((rows()[1] as HTMLElement).style.transform).toBe("translateY(40px)");
});

it("finds a host inside a closed folder and opens the keyboard-selected match", () => {
  const alpha = {
    id: "1",
    name: "alpha",
    ip: "192.0.2.1",
    username: "u",
  } as Host;
  const beta = {
    id: "2",
    name: "beta",
    ip: "192.0.2.2",
    username: "u",
  } as Host;
  const onOpenTab = vi.fn();
  const view = render(
    <SidebarTree
      children={[{ name: "closed", path: "closed", children: [alpha, beta] }]}
      onOpenTab={onOpenTab}
      onEditHost={vi.fn()}
      selectionMode={false}
      onToggleSelectionMode={vi.fn()}
      hostClickBehavior="focusExisting"
    />,
  );
  const list = view.getByLabelText("hosts.speedSearchList");
  expect(view.container.querySelectorAll("[data-index]")).toHaveLength(1);
  fireEvent.keyDown(list, { key: "a" });
  const search = view.getByLabelText("hosts.speedSearch");
  expect(document.activeElement).toBe(search);
  expect(view.container.querySelectorAll("[data-index]")).toHaveLength(3);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onOpenTab).toHaveBeenCalledWith(beta, "terminal", {
    forceNewTab: false,
  });
  fireEvent.keyDown(search, { key: "Escape" });
  expect(view.queryByLabelText("hosts.speedSearch")).toBeNull();
  expect(view.container.querySelectorAll("[data-index]")).toHaveLength(1);
  expect(document.activeElement).toBe(list);
});
