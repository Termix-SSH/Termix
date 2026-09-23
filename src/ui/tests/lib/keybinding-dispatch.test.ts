import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchKeybindingAction } from "../../lib/keybinding-dispatch";
import type { Terminal } from "@xterm/xterm";
import type { KeybindingDispatchContext } from "../../lib/keybinding-dispatch";
import * as actionRegistry from "../../shell/action-registry";

function makeContext(
  overrides: Partial<KeybindingDispatchContext> = {},
): KeybindingDispatchContext & {
  sentData: string[];
} {
  const sentData: string[] = [];
  const ws = {
    readyState: 1,
    send: vi.fn((raw: string) => {
      sentData.push(JSON.parse(raw).data);
    }),
  };

  const ctx: KeybindingDispatchContext & { sentData: string[] } = {
    terminal: {
      getSelection: vi.fn(() => ""),
      clearSelection: vi.fn(),
      paste: vi.fn(),
    } as unknown as Terminal,
    webSocketRef: { current: ws as unknown as WebSocket },
    writeTextToClipboard: vi.fn().mockResolvedValue(true),
    readTextFromClipboard: vi.fn().mockResolvedValue(""),
    sentData,
    ...overrides,
  };
  return ctx;
}

describe("dispatchKeybindingAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("copy writes the selection to clipboard and clears it", () => {
    const ctx = makeContext();
    (ctx.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(
      "hello",
    );
    dispatchKeybindingAction({ type: "copy" }, ctx);
    expect(ctx.writeTextToClipboard).toHaveBeenCalledWith("hello");
    expect(ctx.terminal.clearSelection).toHaveBeenCalled();
  });

  it("copy does nothing when there is no selection", () => {
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "copy" }, ctx);
    expect(ctx.writeTextToClipboard).not.toHaveBeenCalled();
    expect(ctx.terminal.clearSelection).not.toHaveBeenCalled();
  });

  it("paste reads the clipboard and pastes into the terminal", async () => {
    const ctx = makeContext({
      readTextFromClipboard: vi.fn().mockResolvedValue("pasted text"),
    });
    dispatchKeybindingAction({ type: "paste" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.terminal.paste).toHaveBeenCalledWith("pasted text");
  });

  it("sendControlCode sends the corresponding control byte", () => {
    const ctx = makeContext();
    dispatchKeybindingAction(
      { type: "sendControlCode", controlCode: "c" },
      ctx,
    );
    expect(ctx.sentData).toEqual(["\x03"]);
  });

  it("sendText sends literal text without a trailing return by default", () => {
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "sendText", text: "ls -la" }, ctx);
    expect(ctx.sentData).toEqual(["ls -la"]);
  });

  it("sendText appends \\r when appendEnter is true", () => {
    const ctx = makeContext();
    dispatchKeybindingAction(
      { type: "sendText", text: "ls -la", appendEnter: true },
      ctx,
    );
    expect(ctx.sentData).toEqual(["ls -la\r"]);
  });

  it("runSnippet resolves the snippet through the snippets.resolveForTerminal action and sends its content with a trailing return", async () => {
    vi.spyOn(actionRegistry, "invokeAction").mockResolvedValue({
      needsInputs: false,
      content: "uptime",
    });
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(actionRegistry.invokeAction).toHaveBeenCalledWith(
      "snippets.resolveForTerminal",
      1,
      null,
    );
    expect(ctx.sentData).toEqual(["uptime\r"]);
  });

  it("runSnippet does nothing when the snippet no longer exists", async () => {
    vi.spyOn(actionRegistry, "invokeAction").mockResolvedValue(undefined);
    const ctx = makeContext();
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual([]);
  });

  it("runSnippet passes hostContext through to the resolve action", async () => {
    vi.spyOn(actionRegistry, "invokeAction").mockResolvedValue({
      needsInputs: false,
      content: "ping 10.0.0.5 -p 22",
    });
    const ctx = makeContext({
      hostContext: { ip: "10.0.0.5", username: "root", port: 22 },
    });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(actionRegistry.invokeAction).toHaveBeenCalledWith(
      "snippets.resolveForTerminal",
      1,
      { ip: "10.0.0.5", username: "root", port: 22 },
    );
    expect(ctx.sentData).toEqual(["ping 10.0.0.5 -p 22\r"]);
  });

  it("runSnippet defers to onSnippetNeedsInputs instead of sending when the action reports needsInputs", async () => {
    vi.spyOn(actionRegistry, "invokeAction").mockResolvedValue({
      needsInputs: true,
      content: "echo $INPUT_1",
    });
    const onSnippetNeedsInputs = vi.fn();
    const ctx = makeContext({ onSnippetNeedsInputs });
    dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sentData).toEqual([]);
    expect(onSnippetNeedsInputs).toHaveBeenCalledWith({
      id: "1",
      content: "echo $INPUT_1",
    });
  });
});
