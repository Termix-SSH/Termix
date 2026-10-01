import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SshToolsPanel } from "../../../src/frontend/ssh-tools/SshToolsPanel";
import { registerSession } from "../../../src/frontend/session-registry";
import type { TerminalHandle } from "../../../src/frontend/terminal/terminal-types";

const disposers: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
});

function openSession(id: string, label: string) {
  const handle = { sendInput: vi.fn() } as unknown as TerminalHandle;
  act(() => {
    disposers.push(registerSession({ id, hostId: 1, label }, handle));
  });
  return handle;
}

function renderPanel(targetTab?: { id: string }) {
  return render(
    <SshToolsPanel
      targetTab={targetTab as never}
      active
      shell={{} as never}
      setEditing={() => {}}
      placement="left"
    />,
  );
}

describe("SshToolsPanel", () => {
  it("says so when no terminal is open", () => {
    renderPanel();
    expect(screen.getByText("sshTools.noTerminalTabsOpen")).toBeTruthy();
  });

  it("lists open terminals and follows sessions opening later", () => {
    openSession("tab-1", "web-01");
    renderPanel();
    expect(screen.getByText("web-01")).toBeTruthy();
    openSession("tab-2", "db-01");
    expect(screen.getByText("db-01")).toBeTruthy();
  });

  it("types into the selected terminals only", () => {
    const first = openSession("tab-1", "web-01");
    const second = openSession("tab-2", "db-01");
    renderPanel({ id: "tab-1" });

    fireEvent.click(screen.getByText(/sshTools.startRecording/));
    fireEvent.keyDown(
      screen.getByPlaceholderText("sshTools.broadcastInputPlaceholder"),
      { key: "a" },
    );
    expect(first.sendInput).toHaveBeenCalledWith("a");
    expect(second.sendInput).not.toHaveBeenCalled();
  });
});
