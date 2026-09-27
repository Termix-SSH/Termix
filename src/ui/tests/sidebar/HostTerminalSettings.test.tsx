import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HostTerminalSettings } from "@/sidebar/HostTerminalSettings";
import { createHostEditorForm } from "@/sidebar/HostEditorData";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/open-tabs-api", () => ({
  getUserPreferences: vi.fn().mockResolvedValue({ customThemes: null }),
  saveUserPreferences: vi.fn(),
  parseCustomThemes: () => [],
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

function renderSettings(setField = vi.fn()) {
  const form = createHostEditorForm(undefined);
  render(
    <HostTerminalSettings
      form={form}
      setField={setField}
      snippets={[{ id: 7, name: "deploy" }]}
    />,
  );
  return setField;
}

describe("HostTerminalSettings", () => {
  it("renders the appearance and behavior cards", () => {
    renderSettings();
    expect(screen.getByText("hosts.terminalAppearance")).toBeTruthy();
    expect(screen.getByText("hosts.behaviorAndAdvanced")).toBeTruthy();
  });

  it("leaves the keepalive fields to the SSH tab", () => {
    renderSettings();
    expect(screen.queryByText("hosts.keepaliveIntervalLabel")).toBeNull();
  });

  it("sets the startup snippet from the offered snippets", () => {
    const setField = renderSettings();
    const select = screen
      .getByRole("option", { name: "deploy" })
      .closest("select")!;
    fireEvent.change(select, { target: { value: "7" } });
    expect(setField).toHaveBeenCalledWith("startupSnippetId", 7);
  });
});
