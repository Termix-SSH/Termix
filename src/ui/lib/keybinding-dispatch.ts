import type { Terminal } from "@xterm/xterm";
import type { KeybindingAction } from "@/types/keybindings";
import {
  hasSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "@/lib/snippet-variables";

export interface KeybindingDispatchContext {
  terminal: Terminal;
  webSocketRef: React.MutableRefObject<WebSocket | null>;
  writeTextToClipboard: (text: string) => Promise<boolean>;
  readTextFromClipboard: () => Promise<string>;
  getSnippetById: (id: string) => Promise<{ content: string } | undefined>;
  /** Host context used to silently resolve $HOST/$USER/$PORT/$NAME in runSnippet actions. */
  hostContext?: SnippetHostContext | null;
  /**
   * Called instead of sending the snippet directly when its content still has
   * unresolved $INPUT_n placeholders after host-variable substitution -- the
   * caller is expected to collect values (e.g. via a dialog) and send itself.
   */
  onSnippetNeedsInputs?: (snippet: { id: string; content: string }) => void;
}

export function sendRawToSocket(
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  data: string,
): void {
  if (webSocketRef.current?.readyState === 1) {
    webSocketRef.current.send(JSON.stringify({ type: "input", data }));
  }
}

export function dispatchKeybindingAction(
  action: KeybindingAction,
  ctx: KeybindingDispatchContext,
): void {
  const sendRaw = (data: string) => sendRawToSocket(ctx.webSocketRef, data);

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
        if (!snippet) return;
        if (hasSnippetInputs(snippet.content)) {
          ctx.onSnippetNeedsInputs?.({
            id: action.snippetId!,
            content: snippet.content,
          });
          return;
        }
        const resolved = resolveSnippetContent(
          snippet.content,
          ctx.hostContext ?? null,
          {},
        );
        sendRaw(resolved + (action.appendEnter !== false ? "\r" : ""));
      });
      return;
    }
    case "nextTab":
    case "previousTab":
    case "openCommandPalette": {
      window.dispatchEvent(
        new CustomEvent("termix:global-keybinding", {
          detail: { type: action.type },
        }),
      );
      return;
    }
  }
}
