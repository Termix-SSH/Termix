import { describe, expect, it, vi } from "vitest";
import {
  isFirefoxBrowser,
  isPasteShortcut,
  pasteTextToRemote,
  type GuacamoleClipboardClient,
} from "../../../features/guacamole/guacamole-clipboard.js";

describe("Guacamole Firefox clipboard fallback", () => {
  it("only enables the native paste path for Firefox", () => {
    expect(
      isFirefoxBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      ),
    ).toBe(true);
    expect(
      isFirefoxBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0",
      ),
    ).toBe(false);
  });

  it("recognizes Ctrl+V and Command+V without intercepting Alt+V", () => {
    expect(
      isPasteShortcut({
        key: "v",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isPasteShortcut({
        key: "V",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isPasteShortcut({
        key: "v",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });

  it("updates the remote clipboard before sending Ctrl+V", () => {
    const events: string[] = [];
    const client: GuacamoleClipboardClient = {
      createClipboardStream: vi.fn((mimetype: string) => {
        events.push(`stream:${mimetype}`);
        return {
          sendBlob: () => events.push("blob"),
          sendEnd: () => events.push("end"),
        };
      }),
      sendKeyEvent: vi.fn((pressed: number, keysym: number) => {
        events.push(`key:${pressed}:${keysym}`);
      }),
    };

    pasteTextToRemote(client, "Firefox clipboard");

    expect(events).toEqual([
      "stream:text/plain",
      "blob",
      "end",
      "key:1:65507",
      "key:1:118",
      "key:0:118",
      "key:0:65507",
    ]);
  });
});
