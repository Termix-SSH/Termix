import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: { info: vi.fn(), error: vi.fn() },
}));

const { handleDevMessage } = await import("../../plugins/dev-reload.js");

describe("dev reload messages", () => {
  it("reloads the plugin and answers with its state", async () => {
    const send = vi.fn();
    const reload = vi.fn(async () => ({ version: "1.0.0", state: "active" }));
    await handleDevMessage(
      { type: "plugin-reload", id: "snippets" },
      send,
      reload,
    );
    expect(reload).toHaveBeenCalledWith("snippets");
    expect(send).toHaveBeenCalledWith({
      type: "plugin-reloaded",
      id: "snippets",
      state: "active",
    });
  });

  it("answers with the error when the reload fails", async () => {
    const send = vi.fn();
    await handleDevMessage(
      { type: "plugin-reload", id: "snippets" },
      send,
      async () => {
        throw new Error("bad manifest");
      },
    );
    expect(send).toHaveBeenCalledWith({
      type: "plugin-reload-failed",
      id: "snippets",
      error: "bad manifest",
    });
  });

  it("ignores other messages", async () => {
    const send = vi.fn();
    const reload = vi.fn();
    await handleDevMessage({ type: "shutdown" }, send, reload);
    await handleDevMessage({ type: "plugin-reload" }, send, reload);
    await handleDevMessage(null, send, reload);
    expect(reload).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
