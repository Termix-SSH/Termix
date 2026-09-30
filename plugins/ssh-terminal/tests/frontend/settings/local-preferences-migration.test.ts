import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveLocalTerminalPreferences } from "../../../src/frontend/settings/local-preferences-migration";
import { resetTerminalClientSettings } from "../../../src/frontend/terminal-settings";

function api(user: Record<string, unknown>) {
  return {
    get: vi.fn(async () => ({ data: { user } })),
    put: vi.fn(async () => ({ data: {} })),
  };
}

beforeEach(() => {
  localStorage.clear();
  resetTerminalClientSettings();
});

afterEach(() => resetTerminalClientSettings());

describe("moveLocalTerminalPreferences", () => {
  it("does nothing when the browser kept nothing", async () => {
    const client = api({});
    await moveLocalTerminalPreferences({ api: client as never });
    expect(client.get).not.toHaveBeenCalled();
  });

  it("moves the browser's values into settings still at their default, once", async () => {
    localStorage.setItem("terminalLocalEchoMode", "on");
    localStorage.setItem("terminalLinkClickBehavior", "direct");
    localStorage.setItem("commandAutocomplete", "true");
    const client = api({ commandAutocomplete: false });

    await moveLocalTerminalPreferences({ api: client as never });

    expect(client.put).toHaveBeenCalledWith("/user-settings", {
      localEcho: "on",
      linkClickBehavior: "direct",
      commandAutocomplete: true,
    });
    expect(localStorage.getItem("terminalLocalEchoMode")).toBeNull();
    expect(localStorage.getItem("commandAutocomplete")).toBeNull();
  });

  it("keeps a value the user already changed on the server", async () => {
    localStorage.setItem("terminalLocalEchoMode", "off");
    const client = api({ localEcho: "on" });
    await moveLocalTerminalPreferences({ api: client as never });
    expect(client.put).not.toHaveBeenCalled();
    expect(localStorage.getItem("terminalLocalEchoMode")).toBeNull();
  });

  it("keeps the browser values for next time when the server is unreachable", async () => {
    localStorage.setItem("terminalLocalEchoMode", "on");
    const client = {
      get: vi.fn(async () => {
        throw new Error("offline");
      }),
      put: vi.fn(),
    };
    await moveLocalTerminalPreferences({ api: client as never });
    expect(localStorage.getItem("terminalLocalEchoMode")).toBe("on");
  });
});
