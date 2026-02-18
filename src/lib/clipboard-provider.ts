import type {
  IClipboardProvider,
  ClipboardSelectionType,
} from "@xterm/addon-clipboard";

/**
 * A clipboard provider for @xterm/addon-clipboard that handles:
 * - Deferred writes when the document is not focused (browser Clipboard API restriction)
 * - Electron native clipboard when available
 * - Write-only mode for security (readText always returns empty)
 *
 * When multiple OSC 52 writes arrive before focus returns, only the last one
 * is kept (last-write-wins), which matches normal clipboard semantics.
 */
export class RobustClipboardProvider implements IClipboardProvider {
  private pendingWrite: string | null = null;
  private readonly focusHandler: () => void;

  constructor() {
    this.focusHandler = () => {
      if (this.pendingWrite !== null) {
        const text = this.pendingWrite;
        this.pendingWrite = null;
        navigator.clipboard.writeText(text).catch(() => {
          this.pendingWrite = text;
        });
      }
    };
    window.addEventListener("focus", this.focusHandler);
  }

  dispose(): void {
    window.removeEventListener("focus", this.focusHandler);
    this.pendingWrite = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readText(selection: ClipboardSelectionType): string {
    return "";
  }

  async writeText(
    selection: ClipboardSelectionType,
    text: string,
  ): Promise<void> {
    try {
      if (window.electronClipboard) {
        window.electronClipboard.writeText(text);
        return;
      }
      await navigator.clipboard.writeText(text);
    } catch {
      this.pendingWrite = text;
    }
  }
}
