import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchKeybindingAction,
  isTerminalKeybindingAction,
  validateSendControlCode,
  validateSendText,
} from "../../../src/frontend/lib/keybinding-dispatch";
import type { Terminal } from "@xterm/xterm";
import type { KeybindingDispatchContext } from "../../../src/frontend/lib/keybinding-dispatch";

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

  it("leaves any other action to whoever registered it", () => {
    const ctx = makeContext();
    expect(
      dispatchKeybindingAction({ type: "runSnippet", snippetId: "1" }, ctx),
    ).toBe(false);
    expect(dispatchKeybindingAction({ type: "nextTab" }, ctx)).toBe(false);
    expect(dispatchKeybindingAction({ type: "copy" }, ctx)).toBe(true);
    expect(ctx.sentData).toEqual([]);
  });

  it("knows which actions are its own", () => {
    expect(isTerminalKeybindingAction("sendText")).toBe(true);
    expect(isTerminalKeybindingAction("runSnippet")).toBe(false);
  });
});

describe("keybinding validators", () => {
  it("needs text to send", () => {
    expect(validateSendText({ type: "sendText", text: " " })).toBe(
      "keybindings.textRequired",
    );
    expect(validateSendText({ type: "sendText", text: "ls" })).toBeNull();
  });

  it("needs a single letter for a control code", () => {
    expect(
      validateSendControlCode({ type: "sendControlCode", controlCode: "ab" }),
    ).toBe("keybindings.controlCodeRequired");
    expect(
      validateSendControlCode({ type: "sendControlCode", controlCode: "w" }),
    ).toBeNull();
  });
});
