import type { Terminal } from "@xterm/xterm";
import type { KeybindingAction } from "@/types/keybindings";

export interface KeybindingDispatchContext {
  terminal: Terminal;
  webSocketRef: React.MutableRefObject<WebSocket | null>;
  writeTextToClipboard: (text: string) => Promise<boolean>;
  readTextFromClipboard: () => Promise<string>;
  getSnippetById: (id: string) => Promise<{ content: string } | undefined>;
}

export function dispatchKeybindingAction(
  action: KeybindingAction,
  ctx: KeybindingDispatchContext,
): void {
  const sendRaw = (data: string) => {
    if (ctx.webSocketRef.current?.readyState === 1) {
      ctx.webSocketRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  switch (action.type) {
    case "copy": {
      const selection = ctx.terminal.getSelection();
      if (selection) {
        ctx.writeTextToClipboard(selection);
        ctx.terminal.clearSelection();
      }
      return;
    }
    case "paste": {
      ctx.readTextFromClipboard().then((text) => {
        if (text) ctx.terminal.paste(text);
      });
      return;
    }
    case "sendControlCode": {
      if (!action.controlCode) return;
      const code = action.controlCode.toLowerCase().charCodeAt(0) - 96;
      if (code >= 1 && code <= 26) sendRaw(String.fromCharCode(code));
      return;
    }
    case "sendText": {
      sendRaw((action.text ?? "") + (action.appendEnter ? "\r" : ""));
      return;
    }
    case "runSnippet": {
      if (!action.snippetId) return;
      ctx.getSnippetById(action.snippetId).then((snippet) => {
        if (snippet)
          sendRaw(snippet.content + (action.appendEnter !== false ? "\r" : ""));
      });
      return;
    }
  }
}
