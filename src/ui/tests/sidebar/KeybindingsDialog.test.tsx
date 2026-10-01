import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const saved = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/api/open-tabs-api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserPreferences: async () => ({ customKeybindings: saved.value }),
}));
vi.mock("@/main-axios", () => ({ saveUserPreferences: vi.fn() }));

const { KeybindingsDialog } = await import("../../sidebar/KeybindingsDialog");
const {
  registerKeybindingAction,
  registerKeybindingDefault,
  resetKeybindingRegistry,
} = await import("../../shell/keybinding-registry");

afterEach(() => {
  cleanup();
  resetKeybindingRegistry();
  saved.value = null;
});

const combo = {
  key: "k",
  isCode: false,
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
};

describe("KeybindingsDialog", () => {
  it("lists registered defaults and keeps a binding whose plugin is off", async () => {
    registerKeybindingDefault({
      id: "default-x",
      pluginId: "sample",
      combo,
      descriptionKey: "sample:builtInX",
    });
    saved.value = JSON.stringify([
      {
        id: "a",
        combo,
        action: { type: "gone.action" },
        enabled: true,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    render(<KeybindingsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText("sample:builtInX")).toBeTruthy();
    expect(
      await screen.findByText("newUi.sidebar.keybindings.unavailableAction"),
    ).toBeTruthy();
  });

  it("offers every registered action and draws the chosen one's editor", async () => {
    registerKeybindingAction({
      id: "sample.send",
      pluginId: "sample",
      labelKey: "sample:send",
      scope: "session",
      editor: () => <span>sample editor</span>,
    });
    render(<KeybindingsDialog open onOpenChange={() => {}} />);
    fireEvent.click(
      await screen.findByText("newUi.sidebar.keybindings.addBinding"),
    );
    const select = (await screen.findByRole("option", { name: "sample:send" }))
      .parentElement as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain(
      "nextTab",
    );
    fireEvent.change(select, { target: { value: "sample.send" } });
    expect(await screen.findByText("sample editor")).toBeTruthy();
  });
});
