import Guacamole from "guacamole-common-js";

const CONTROL_LEFT_KEYSYM = 0xffe3;
const V_KEYSYM = 0x76;

interface ClipboardOutputStream {
  sendBlob(data: string): void;
  sendEnd(): void;
}

export interface GuacamoleClipboardClient {
  createClipboardStream(mimetype: string): ClipboardOutputStream;
  sendKeyEvent(pressed: number, keysym: number): void;
}

export function isFirefoxBrowser(userAgent = navigator.userAgent): boolean {
  return /(?:Firefox|FxiOS)\//.test(userAgent);
}

export function isPasteShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
): boolean {
  return (
    !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "v"
  );
}

export function pasteTextToRemote(
  client: GuacamoleClipboardClient,
  text: string,
): void {
  const stream = client.createClipboardStream("text/plain");
  const writer = new Guacamole.StringWriter(stream);
  writer.sendText(text);
  writer.sendEnd();

  client.sendKeyEvent(1, CONTROL_LEFT_KEYSYM);
  client.sendKeyEvent(1, V_KEYSYM);
  client.sendKeyEvent(0, V_KEYSYM);
  client.sendKeyEvent(0, CONTROL_LEFT_KEYSYM);
}
