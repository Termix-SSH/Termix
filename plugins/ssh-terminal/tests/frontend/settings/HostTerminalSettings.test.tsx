import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HostTerminalSettings } from "../../../src/frontend/settings/HostTerminalSettings";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

type Form = Record<string, unknown>;

/** The switch on the setting row labelled with this key. */
function switchFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("div.justify-between")!;
  return row.querySelector("button")!;
}

function renderSettings(form: Form = { pluginSettings: {} }) {
  let current: Form = form;
  const setField = vi.fn();
  const updateForm = vi.fn((patch: (form: Form) => Form) => {
    current = patch(current);
  });
  render(
    <HostTerminalSettings
      form={form}
      setField={setField}
      updateForm={updateForm}
      host={{ id: "1", name: "box", ip: "10.0.0.1", port: 22 }}
    />,
  );
  return { setField, updateForm, current: () => current };
}

describe("HostTerminalSettings", () => {
  it("renders the appearance and behavior cards", () => {
    renderSettings();
    expect(screen.getByText("hosts.terminalAppearance")).toBeTruthy();
    expect(screen.getByText("hosts.behaviorAndAdvanced")).toBeTruthy();
  });

  it("leaves the SSH connection options to the core SSH tab", () => {
    renderSettings();
    expect(screen.queryByText("hosts.keepaliveIntervalLabel")).toBeNull();
    expect(screen.queryByText("hosts.environmentVariablesLabel")).toBeNull();
    expect(screen.queryByText("hosts.sshAgentForwardingLabel")).toBeNull();
  });

  it("draws the auto-fill switches that left the SSH tab", () => {
    renderSettings();
    expect(screen.getByText("hosts.passwordPromptAutoFillLabel")).toBeTruthy();
    expect(screen.getByText("hosts.sudoPasswordAutoFillLabel")).toBeTruthy();
  });

  it("no longer draws the startup snippet, which is the snippets plugin's", () => {
    renderSettings();
    expect(screen.queryByText("hosts.startupSnippetLabel")).toBeNull();
  });

  it("writes its values into the host's ssh-terminal settings", () => {
    const { current } = renderSettings({
      pluginSettings: { other: { keep: true } },
    });
    fireEvent.click(switchFor("hosts.enableAutoMosh"));
    expect(current().pluginSettings).toEqual({
      other: { keep: true },
      "ssh-terminal": { autoMosh: true },
    });
  });

  it("takes the host off the user's look when the look changes", () => {
    const { current } = renderSettings({
      pluginSettings: { "ssh-terminal": { inheritAppearance: false } },
    });
    fireEvent.click(switchFor("hosts.cursorBlinking"));
    expect(
      (current().pluginSettings as Record<string, Form>)["ssh-terminal"],
    ).toMatchObject({ cursorBlink: false, inheritAppearance: false });
  });
});
