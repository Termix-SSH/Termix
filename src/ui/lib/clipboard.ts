/**
 * Copies text to the clipboard, working around environments where the async
 * Clipboard API is unavailable - notably Brave and any non-HTTPS origin, where
 * `navigator.clipboard` is undefined. Tries the Electron bridge first, then the
 * async Clipboard API, then a hidden-textarea execCommand fallback.
 *
 * Returns true on success so callers can decide whether to show a success or
 * error toast.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.electronClipboard) {
    try {
      await window.electronClipboard.writeText(text);
      return true;
    } catch {
      // fall through to browser approaches
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy fallback
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
