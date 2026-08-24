import { describe, expect, it, vi } from "vitest";
import {
  isPasteShortcut,
  pasteTextToRemote,
  type GuacamoleClipboardClient,
} from "../../../features/guacamole/guacamole-clipboard.js";

describe("Guacamole clipboard paste", () => {
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
