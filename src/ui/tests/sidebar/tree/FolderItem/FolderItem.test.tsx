import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { HostFolder } from "@/types/ui-types";
import { FolderItem } from "@/sidebar/tree/FolderItem/FolderItem";

vi.mock("@/lib/ServerStatusContext", () => ({
  useServerStatus: () => ({ getStatus: () => "online" }),
}));
vi.mock("@/sidebar/tree/HostItem/HostItem", () => ({
  HostItem: () => null,
  statusCheckEnabled: () => true,
}));

const folder = {
  name: "Production",
  path: "Production",
  children: [],
} as unknown as HostFolder;

function renderFolder(onToggleFolder = vi.fn()) {
  const noop = vi.fn();
  render(
    <FolderItem
      folder={folder}
      flat
      onOpenTab={noop}
      onDeleteHost={noop}
      onDuplicateHost={noop}
      openFolders={new Set()}
      onToggleFolder={onToggleFolder}
      selectionMode={false}
      selectedHostIds={new Set()}
      onToggleSelect={noop}
      onToggleSelectFolder={noop}
      openMenuHostId={null}
      onMenuOpenChange={noop}
      openTrayHostId={null}
      onTrayOpenChange={noop}
      onManageFolder={noop}
      onDeleteFolder={noop}
      onOpenAllSessions={noop}
      onMoveHostsToFolder={noop}
      draggedHostIds={null}
      onDragHostStart={noop}
      onDragEnd={noop}
    />,
  );
  return onToggleFolder;
}

it("never nests the folder actions inside a button element", () => {
  renderFolder();
  for (const button of document.querySelectorAll("button")) {
    expect(button.parentElement?.closest("button")).toBeNull();
  }
});

it("toggles the folder by click, Enter and Space", () => {
  const onToggle = renderFolder();
  const header = document.querySelector('[role="button"][aria-expanded]')!;
  fireEvent.click(header);
  fireEvent.keyDown(header, { key: "Enter" });
  fireEvent.keyDown(header, { key: " " });
  expect(onToggle).toHaveBeenCalledTimes(3);
  expect(onToggle).toHaveBeenCalledWith("Production");
});

it("ignores keys pressed on a folder action", () => {
  const onToggle = renderFolder();
  const action = document.querySelector("button")!;
  fireEvent.keyDown(action, { key: "Enter" });
  expect(onToggle).not.toHaveBeenCalled();
});
