import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";
let rendered: RenderedPluginApp | null = null;
const original = window.electronAPI;
afterEach(async () => {
  await act(async () => {
    await rendered?.deactivate();
  });
  rendered = null;
  window.electronAPI = original;
});

describe("tunnel prompt overlay", () => {
  it("queues challenges, clears the previous code, and cancels on plugin disposal", async () => {
    type Event = Parameters<
      Parameters<typeof window.electronAPI.onC2SAuthPrompt>[0]
    >[0];
    let receive!: (event: Event) => void;
    const answer = vi.fn().mockResolvedValue(true);
    const unsubscribe = vi.fn();
    window.electronAPI = {
      ...original,
      answerC2SAuth: answer,
      onC2SAuthPrompt: (fn) => {
        receive = fn;
        return unsubscribe;
      },
    };
    rendered = await renderWithApp(plugin, {
      manifest: manifestJson as unknown as PluginManifest,
      locales,
    });
    rendered.renderSlot("shell.overlay");
    act(() => {
      receive({
        id: "one",
        tunnelName: "SOCKS",
        request: { kind: "totp", prompt: "Code:", retry: false },
      });
      receive({
        id: "two",
        tunnelName: "Other",
        request: { kind: "totp", prompt: "Code:", retry: true },
      });
    });
    const input = screen.getByLabelText("Authentication response");
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("Continue"));
    expect(answer).toHaveBeenCalledWith("one", "123456");
    expect(
      (screen.getByLabelText("Authentication response") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("previous code");
    act(() => receive({ id: "two", closed: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() =>
      receive({
        id: "three",
        request: {
          kind: "input",
          prompt: "Password:",
          echo: false,
          isPush: false,
        },
      }),
    );
    await act(async () => {
      await rendered!.deactivate();
    });
    rendered = null;
    expect(answer).toHaveBeenCalledWith("three", null);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
