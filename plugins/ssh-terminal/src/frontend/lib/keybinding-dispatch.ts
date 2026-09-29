import type { Terminal } from "@xterm/xterm";
import type {
  KeybindingAction,
  KeybindingDefaultContribution,
} from "@termix/plugin-sdk/frontend";

export interface KeybindingDispatchContext {
  terminal: Terminal;
  webSocketRef: React.MutableRefObject<WebSocket | null>;
  writeTextToClipboard: (text: string) => Promise<boolean>;
  readTextFromClipboard: () => Promise<string>;
}

/** The keybinding actions the terminal runs itself. */
export const TERMINAL_KEYBINDING_ACTIONS = [
  "copy",
  "paste",
  "sendControlCode",
  "sendText",
] as const;

export function isTerminalKeybindingAction(type: string): boolean {
  return (TERMINAL_KEYBINDING_ACTIONS as readonly string[]).includes(type);
}

export function sendRawToSocket(
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  data: string,
): void {
  if (webSocketRef.current?.readyState === 1) {
    webSocketRef.current.send(JSON.stringify({ type: "input", data }));
  }
}

function text(action: KeybindingAction, key: string): string {
  const value = action[key];
  return typeof value === "string" ? value : "";
}

/**
 * Runs one of the terminal's own bound actions. False for any other type,
 * which the terminal hands on to whoever registered it.
 */
export function dispatchKeybindingAction(
  action: KeybindingAction,
  ctx: KeybindingDispatchContext,
): boolean {
  const sendRaw = (data: string) => sendRawToSocket(ctx.webSocketRef, data);

  switch (action.type) {
    case "copy": {
      const selection = ctx.terminal.getSelection();
      if (selection) {
        ctx.writeTextToClipboard(selection);
        ctx.terminal.clearSelection();
      }
      return true;
    }
    case "paste": {
      ctx.readTextFromClipboard().then((value) => {
        if (value) ctx.terminal.paste(value);
      });
      return true;
    }
    case "sendControlCode": {
      const letter = text(action, "controlCode");
      if (!letter) return true;
      const code = letter.toLowerCase().charCodeAt(0) - 96;
      if (code >= 1 && code <= 26) sendRaw(String.fromCharCode(code));
      return true;
    }
    case "sendText": {
      sendRaw(text(action, "text") + (action.appendEnter === true ? "\r" : ""));
      return true;
    }
    default:
      return false;
  }
}

export function validateSendText(action: KeybindingAction): string | null {
  return text(action, "text").trim() ? null : "keybindings.textRequired";
}

export function validateSendControlCode(
  action: KeybindingAction,
): string | null {
  return /^[a-zA-Z]$/.test(text(action, "controlCode"))
    ? null
    : "keybindings.controlCodeRequired";
}

function combo(
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
) {
  return {
    key,
    isCode: false,
    ctrl: !!modifiers.ctrl,
    alt: !!modifiers.alt,
    shift: !!modifiers.shift,
    meta: !!modifiers.meta,
  };
}

/** The terminal's built-in keys, listed so a user can rebind them. */
export const TERMINAL_KEYBINDING_DEFAULTS: KeybindingDefaultContribution[] = [
  {
    id: "default-copy-ctrlc",
    combo: combo("c", { ctrl: true }),
    descriptionKey: "keybindings.builtIn.copyCtrlC",
  },
  {
    id: "default-copy-ctrlshiftc",
    combo: combo("c", { ctrl: true, shift: true }),
    descriptionKey: "keybindings.builtIn.copyCtrlShiftC",
  },
  {
    id: "default-copy-cmdc",
    combo: combo("c", { meta: true }),
    descriptionKey: "keybindings.builtIn.copyCmdC",
  },
  {
    id: "default-paste-ctrlshiftv",
    combo: combo("v", { ctrl: true, shift: true }),
    descriptionKey: "keybindings.builtIn.pasteCtrlShiftV",
  },
  {
    id: "default-ctrlaltw",
    combo: combo("w", { ctrl: true, alt: true }),
    descriptionKey: "keybindings.builtIn.ctrlW",
  },
  {
    id: "default-ctrlaltt",
    combo: combo("t", { ctrl: true, alt: true }),
    descriptionKey: "keybindings.builtIn.ctrlT",
  },
  {
    id: "default-ctrlaltn",
    combo: combo("n", { ctrl: true, alt: true }),
    descriptionKey: "keybindings.builtIn.ctrlN",
  },
  {
    id: "default-ctrlaltq",
    combo: combo("q", { ctrl: true, alt: true }),
    descriptionKey: "keybindings.builtIn.ctrlQ",
  },
];
