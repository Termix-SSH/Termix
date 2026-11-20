import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/diagnostics/DiagnosticsView", () => ({
  DiagnosticsView: ({ focusPluginId }: { focusPluginId?: string }) => (
    <div>report for {focusPluginId ?? "all"}</div>
  ),
}));

const { DiagnosticsHost } = await import("@/diagnostics/DiagnosticsHost");
const { openDiagnostics, diagnosticsRequested, isDiagnosticsShortcut } =
  await import("@/diagnostics/open-diagnostics");

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("DiagnosticsHost", () => {
  it("stays closed until asked", () => {
    render(<DiagnosticsHost />);
    expect(screen.queryByText(/report for/)).toBeNull();
  });

  it("opens for a plugin when asked", async () => {
    render(<DiagnosticsHost />);
    act(() => openDiagnostics({ pluginId: "ai" }));
    expect(await screen.findByText("report for ai")).toBeTruthy();
  });

  it("opens on the shortcut", async () => {
    render(<DiagnosticsHost />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyD",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(await screen.findByText("report for all")).toBeTruthy();
  });

  it("opens on load for ?diagnostics", async () => {
    window.history.replaceState({}, "", "/?diagnostics");
    expect(diagnosticsRequested()).toBe(true);
    render(<DiagnosticsHost />);
    expect(await screen.findByText("report for all")).toBeTruthy();
  });
});

describe("isDiagnosticsShortcut", () => {
  it("needs all three modifiers", () => {
    expect(
      isDiagnosticsShortcut(
        new KeyboardEvent("keydown", {
          code: "KeyD",
          ctrlKey: true,
          altKey: true,
        }),
      ),
    ).toBe(false);
  });
});
