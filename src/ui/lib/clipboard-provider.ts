import type {
  IClipboardProvider,
  ClipboardSelectionType,
} from "@xterm/addon-clipboard";

export class RobustClipboardProvider implements IClipboardProvider {
  private pendingWrite: string | null = null;
  private readonly focusHandler: () => void;

  constructor() {
    this.focusHandler = () => {
      if (this.pendingWrite !== null) {
        const text = this.pendingWrite;
        this.pendingWrite = null;
        if (window.electronClipboard) {
          window.electronClipboard.writeText(text).catch(() => {
            this.pendingWrite = text;
          });
          return;
        }
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

  readText(_selection: ClipboardSelectionType): string | Promise<string> {
    if (window.electronClipboard) {
      return window.electronClipboard.readText();
    }
    return navigator.clipboard?.readText?.() ?? "";
  }

  async writeText(
    _selection: ClipboardSelectionType,
    text: string,
  ): Promise<void> {
    try {
      if (window.electronClipboard) {
        await window.electronClipboard.writeText(text);
        return;
      }
      await navigator.clipboard.writeText(text);
    } catch {
      this.pendingWrite = text;
    }
  }
}
