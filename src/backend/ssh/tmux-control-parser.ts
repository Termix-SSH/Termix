// Pure incremental parser for tmux control-mode (`tmux -C`) output.
// Kept free of SSH/WebSocket dependencies so it can be unit-tested.

/**
 * Decode tmux control-mode escaped text. Control mode escapes every
 * non-printable byte as a 3-digit octal sequence (`\015` CR, `\033` ESC, ...)
 * and escapes backslash itself as `\\`. Octal escapes encode raw bytes, so
 * multi-byte UTF-8 characters arrive as multiple escapes (e.g. "é" as
 * `\303\251`); the bytes are decoded into a Buffer and then interpreted as
 * UTF-8.
 */
export function decodeControlModeText(s: string): string {
  const parts: Buffer[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < s.length) {
    if (s[i] !== "\\") {
      i++;
      continue;
    }
    if (plainStart < i) {
      parts.push(Buffer.from(s.slice(plainStart, i), "utf8"));
    }

    const next = s[i + 1];
    if (next === "\\") {
      parts.push(Buffer.from([0x5c]));
      i += 2;
    } else if (/^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
      parts.push(Buffer.from([parseInt(s.slice(i + 1, i + 4), 8)]));
      i += 4;
    } else {
      // Lone backslash that tmux would not normally emit -- keep it as-is.
      parts.push(Buffer.from([0x5c]));
      i += 1;
    }
    plainStart = i;
  }

  if (plainStart < s.length) {
    parts.push(Buffer.from(s.slice(plainStart), "utf8"));
  }
  return Buffer.concat(parts).toString("utf8");
}

export interface ControlModeHandlers {
  /** `%output %<paneId> <data>` lines, with the data already decoded. */
  onOutput: (paneId: string, data: string) => void;
  /** `%exit [reason]` -- the control client detached or the server exited. */
  onExit: (reason?: string) => void;
  /** Any session/window structure notification (add/close/rename/layout). */
  onStructureChange?: () => void;
}

export interface ControlModeParser {
  /** Feed a raw chunk from the control-mode stream (may end mid-line). */
  feed(chunk: string | Buffer): void;
}

const STRUCTURE_NOTIFICATIONS = new Set([
  "%session-changed",
  "%window-add",
  "%window-close",
  "%layout-change",
  "%window-renamed",
]);

/**
 * Create an incremental line parser for tmux control-mode output. Partial
 * lines are buffered across feed() calls. Command reply blocks
 * (`%begin` ... `%end`/`%error`) are swallowed; only asynchronous
 * notifications are dispatched to the handlers.
 */
export function createControlModeParser(
  handlers: ControlModeHandlers,
): ControlModeParser {
  let buffer = "";
  let inReplyBlock = false;

  function handleLine(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return;

    const word = line.split(" ", 1)[0];

    if (inReplyBlock) {
      if (word === "%end" || word === "%error") {
        inReplyBlock = false;
      }
      return; // swallow command replies entirely
    }

    if (!line.startsWith("%")) return;

    switch (word) {
      case "%begin":
        inReplyBlock = true;
        return;
      case "%output": {
        // "%output %<paneId> <data>" -- data starts after the second space
        // and may itself contain spaces.
        const paneStart = line.indexOf(" ") + 1;
        const dataStart = line.indexOf(" ", paneStart);
        if (paneStart <= 0 || dataStart === -1) return;
        const paneId = line.slice(paneStart, dataStart);
        if (!paneId.startsWith("%")) return;
        handlers.onOutput(
          paneId,
          decodeControlModeText(line.slice(dataStart + 1)),
        );
        return;
      }
      case "%exit": {
        const reason = line.length > "%exit".length ? line.slice(6) : undefined;
        handlers.onExit(reason);
        return;
      }
      default:
        if (STRUCTURE_NOTIFICATIONS.has(word)) {
          handlers.onStructureChange?.();
        }
        // Unknown %... notifications are ignored silently.
        return;
    }
  }

  return {
    feed(chunk: string | Buffer): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line);
      }
    },
  };
}
