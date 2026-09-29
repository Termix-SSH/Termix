import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TerminalDefaultsSettings } from "../../../src/frontend/settings/TerminalDefaultsSettings";

afterEach(cleanup);

describe("TerminalDefaultsSettings", () => {
  it("counts the defaults the user set", () => {
    render(
      <TerminalDefaultsSettings
        pluginId="ssh-terminal"
        values={{ terminalDefaults: { fontSize: 18, cursorBlink: false } }}
        setValue={vi.fn()}
        running
      />,
    );
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("applies the dialog's values to the terminalDefaults setting", () => {
    const setValue = vi.fn();
    render(
      <TerminalDefaultsSettings
        pluginId="ssh-terminal"
        values={{ terminalDefaults: { fontSize: 18 } }}
        setValue={setValue}
        running
      />,
    );
    fireEvent.click(screen.getByText("terminalDefaults.manage"));
    fireEvent.change(screen.getByDisplayValue("18"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByText("terminalDefaults.apply"));
    expect(setValue).toHaveBeenCalledWith("terminalDefaults", { fontSize: 20 });
  });
});
